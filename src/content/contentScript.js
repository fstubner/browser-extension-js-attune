(() => {
  if (window.__ATTUNE__) return;
  window.__ATTUNE__ = { version: "0.1.0" };

  const state = {
    enabled: true,
    vocalEnhanced: false,
    started: false,
    lastError: null
  };

  let audioContext = null;
  let rafId = null;
  const processors = new Set();
  const elementToProcessor = new WeakMap();
  const instrumentedElements = new WeakSet();

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  class MediaProcessor {
    constructor(mediaEl) {
      this.mediaEl = mediaEl;
      this.active = false;
      this.enabled = true;

      this.source = null;
      this.preGain = null;
      this.bypassGain = null;
      this.compressor = null;
      this.analyser = null;
      this.autoGain = null;
      this.limiter = null;
      this.effectGain = null;

      // Vocal Enhancement Nodes
      this.vocalFilter = null;
      this.vocalCompressor = null;
      this.vocalPathGain = null;
      this.directPathGain = null;

      this.buffer = null;
      this.currentGain = 1;

      this.targetDb = -18;
      this.minGain = 0.35;
      this.maxGain = 5.5;

      this.reduceSpeed = 0.18;
      this.raiseSpeed = 0.06;

      this._init();
    }

    _init() {
      this.preGain = audioContext.createGain();
      this.preGain.gain.value = 1;

      this.bypassGain = audioContext.createGain();
      this.bypassGain.gain.value = 1;

      this.compressor = audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.22;

      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.85;
      this.buffer = new Float32Array(this.analyser.fftSize);

      this.autoGain = audioContext.createGain();
      this.autoGain.gain.value = 1;

      this.limiter = audioContext.createDynamicsCompressor();
      this.limiter.threshold.value = -2.0;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.0015;
      this.limiter.release.value = 0.05;

      this.effectGain = audioContext.createGain();
      this.effectGain.gain.value = 0;

      // Vocal Enhancement Setup
      this.vocalFilter = audioContext.createBiquadFilter();
      this.vocalFilter.type = "bandpass";
      this.vocalFilter.frequency.value = 1200; // Center of vocal range approx
      this.vocalFilter.Q.value = 0.5; // Wide bandwidth (covers ~300Hz to ~3kHz)

      this.vocalCompressor = audioContext.createDynamicsCompressor();
      this.vocalCompressor.threshold.value = -30;
      this.vocalCompressor.knee.value = 12;
      this.vocalCompressor.ratio.value = 12; // Heavy compression for vocals
      this.vocalCompressor.attack.value = 0.002;
      this.vocalCompressor.release.value = 0.15;

      this.vocalPathGain = audioContext.createGain();
      this.vocalPathGain.gain.value = 0;

      this.directPathGain = audioContext.createGain();
      this.directPathGain.gain.value = 1;

      try {
        this.source = audioContext.createMediaElementSource(this.mediaEl);
      } catch (err) {
        this._fail(err);
        return;
      }

      // Connectivity Graph
      // 1. Bypass Path
      // source -> preGain -> bypassGain -> destination
      this.source.connect(this.preGain);
      this.preGain.connect(this.bypassGain);
      this.bypassGain.connect(audioContext.destination);

      // 2. Active Path (Auto-leveling)
      // We insert a switch (vocal vs direct) before the main compressor.
      // preGain -> directPathGain -> compressor
      // preGain -> vocalPathGain -> vocalFilter -> vocalCompressor -> compressor

      this.preGain.connect(this.directPathGain);
      this.directPathGain.connect(this.compressor);

      this.preGain.connect(this.vocalPathGain);
      this.vocalPathGain.connect(this.vocalFilter);
      this.vocalFilter.connect(this.vocalCompressor);
      this.vocalCompressor.connect(this.compressor);

      // Continue main chain:
      // compressor -> analyser -> autoGain -> limiter -> effectGain -> destination
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.autoGain);
      this.autoGain.connect(this.limiter);
      this.limiter.connect(this.effectGain);
      this.effectGain.connect(audioContext.destination);

      this.setEnabled(state.enabled);
      this.setVocalEnhanced(state.vocalEnhanced);
    }

    _fail(err) {
      this.active = false;
      state.lastError = String(err?.message || err || "unknown_error");
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);

      const now = audioContext?.currentTime ?? 0;
      const t = 0.03;
      if (this.enabled) {
        this.bypassGain.gain.setTargetAtTime(0, now, t);
        this.effectGain.gain.setTargetAtTime(1, now, t);
      } else {
        this.bypassGain.gain.setTargetAtTime(1, now, t);
        this.effectGain.gain.setTargetAtTime(0, now, t);
        this.autoGain.gain.setTargetAtTime(1, now, t);
        this.currentGain = 1;
      }
    }

    setVocalEnhanced(enhanced) {
      // If global disabled, meaningful switch happens on enable.
      // But we update gains so when enabled it is correct.
      const now = audioContext?.currentTime ?? 0;
      const t = 0.05; // slightly slower crossfade

      if (enhanced) {
        this.directPathGain.gain.setTargetAtTime(0, now, t);
        this.vocalPathGain.gain.setTargetAtTime(1, now, t);
        // Boost targetDb slightly in vocal mode as we are cutting noise
        this.targetDb = -16;
      } else {
        this.directPathGain.gain.setTargetAtTime(1, now, t);
        this.vocalPathGain.gain.setTargetAtTime(0, now, t);
        this.targetDb = -18;
      }
    }

    onPlay() {
      this.active = true;
    }

    onPause() {
      this.active = false;
    }

    update() {
      if (!this.active || !this.analyser || !this.enabled) return;
      if (!audioContext || audioContext.state !== "running") return;

      let rms = 0;
      if (this.analyser.getFloatTimeDomainData) {
        this.analyser.getFloatTimeDomainData(this.buffer);
        for (let i = 0; i < this.buffer.length; i++) rms += this.buffer[i] * this.buffer[i];
        rms = Math.sqrt(rms / this.buffer.length);
      } else {
        const byteBuffer = new Uint8Array(this.buffer.length);
        this.analyser.getByteTimeDomainData(byteBuffer);
        for (let i = 0; i < byteBuffer.length; i++) {
          const x = (byteBuffer[i] - 128) / 128;
          rms += x * x;
        }
        rms = Math.sqrt(rms / byteBuffer.length);
      }

      const rmsDb = 20 * Math.log10(Math.max(1e-6, rms));
      const desiredGain = Math.min(this.maxGain, Math.max(this.minGain, dbToGain(this.targetDb - rmsDb)));

      const speed = desiredGain < this.currentGain ? this.reduceSpeed : this.raiseSpeed;
      this.currentGain += (desiredGain - this.currentGain) * speed;

      if (!Number.isFinite(this.currentGain)) this.currentGain = 1;
      this.autoGain.gain.setTargetAtTime(this.currentGain, audioContext.currentTime, 0.03);
    }
  }

  function ensureAudioContext() {
    if (audioContext) return true;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      return true;
    } catch (err) {
      state.lastError = String(err?.message || err || "audio_context_failed");
      return false;
    }
  }

  async function ensureAudioContextRunning() {
    if (!ensureAudioContext()) return false;
    if (audioContext.state === "running") return true;
    try {
      await audioContext.resume();
    } catch {
      // Autoplay policies may block this until a user gesture.
    }
    return audioContext.state === "running";
  }

  async function handlePlay(el) {
    if (!state.enabled) return;
    const ok = await ensureAudioContextRunning();
    if (!ok) return;

    let processor = elementToProcessor.get(el);
    if (!processor) {
      processor = new MediaProcessor(el);
      elementToProcessor.set(el, processor);
      processors.add(processor);
    }

    processor.onPlay();
    ensureTicking();
  }

  function handlePause(el) {
    const processor = elementToProcessor.get(el);
    if (processor) processor.onPause();
  }

  function maybeStartForAlreadyPlayingMedia() {
    document.querySelectorAll("audio,video").forEach((el) => {
      if (!(el instanceof HTMLMediaElement)) return;
      if (!el.paused && !el.ended) void handlePlay(el);
    });
  }

  function maybeResumeAudioContext() {
    if (!audioContext) return;
    if (audioContext.state === "running") return;
    void audioContext.resume().catch(() => {});
  }

  function attachToElement(el) {
    if (!el || instrumentedElements.has(el)) return;
    if (!(el instanceof HTMLMediaElement)) return;

    instrumentedElements.add(el);

    el.addEventListener("play", () => {
      void handlePlay(el);
    });
    el.addEventListener("pause", () => handlePause(el));
    el.addEventListener("ended", () => handlePause(el));
  }

  function scan() {
    document.querySelectorAll("audio,video").forEach(attachToElement);
  }

  function observeNewMedia() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.("audio,video")) attachToElement(node);
          node.querySelectorAll?.("audio,video").forEach(attachToElement);
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function tick() {
    if (!state.enabled) return (rafId = null);

    let anyActive = false;
    for (const p of processors) p.update();
    for (const p of processors) {
      if (p.active && p.enabled) {
        anyActive = true;
        break;
      }
    }

    rafId = anyActive ? window.requestAnimationFrame(tick) : null;
  }

  function ensureTicking() {
    if (!state.enabled) return;
    if (rafId) return;
    rafId = window.requestAnimationFrame(tick);
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    for (const p of processors) p.setEnabled(state.enabled);
    if (state.enabled) {
      maybeStartForAlreadyPlayingMedia();
      ensureTicking();
    }
  }

  function setVocalEnhanced(enhanced) {
    state.vocalEnhanced = Boolean(enhanced);
    for (const p of processors) p.setVocalEnhanced(state.vocalEnhanced);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "ATTUNE_PING") {
      sendResponse({
        ok: true,
        version: window.__ATTUNE__?.version,
        enabled: state.enabled,
        audioContextState: audioContext?.state || "none",
        processors: processors.size,
        lastError: state.lastError
      });
      return;
    }

    if (msg?.type === "ATTUNE_SET_ENABLED") {
      setEnabled(Boolean(msg.enabled));
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "ATTUNE_SET_VOCAL_ENHANCED") {
      setVocalEnhanced(Boolean(msg.enabled));
      sendResponse({ ok: true });
      return;
    }
  });

  function init() {
    if (state.started) return;
    state.started = true;

    // Resume context on first user gesture (helps with autoplay sites).
    const resumeOnce = () => {
      maybeResumeAudioContext();
      if (state.enabled) void ensureAudioContextRunning().then(() => maybeStartForAlreadyPlayingMedia());
      window.removeEventListener("pointerdown", resumeOnce, true);
      window.removeEventListener("keydown", resumeOnce, true);
      window.removeEventListener("touchstart", resumeOnce, true);
    };
    window.addEventListener("pointerdown", resumeOnce, true);
    window.addEventListener("keydown", resumeOnce, true);
    window.addEventListener("touchstart", resumeOnce, true);

    scan();
    observeNewMedia();
    if (state.enabled) maybeStartForAlreadyPlayingMedia();
  }

  void chrome.runtime.sendMessage({ type: "ATTUNE_GET_CONFIG" }, (config) => {
    state.enabled = Boolean(config?.globalEnabled);
    state.vocalEnhanced = Boolean(config?.vocalEnhanced);

    // Processors created in init -> scan will read state.vocalEnhanced
    init();

    // Apply initial state to any processors that might have been created by race?
    // (Unlikely as init does scan, but good for consistency if we move scan)
    setEnabled(state.enabled);
    setVocalEnhanced(state.vocalEnhanced);
  });
})();