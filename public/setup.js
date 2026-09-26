(function () {
  'use strict';

  // ── Theme Switcher (Auto, Dark, Light) ──────────────────────────────────
  const THEME_STORAGE_KEY = 'telemusic_theme';
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');

  const THEMES = ['auto', 'dark', 'light'];
  const THEME_DATA = {
    auto: {
      label: 'Auto',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18v-18z" fill="currentColor"/></svg>',
    },
    dark: {
      label: 'Dark',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    },
    light: {
      label: 'Light',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    },
  };

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'auto';
    document.documentElement.setAttribute('data-theme', theme);
    if (themeLabel) themeLabel.textContent = THEME_DATA[theme].label;
    if (themeIcon) themeIcon.innerHTML = THEME_DATA[theme].svg;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  function cycleTheme() {
    const current = localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
    const nextIdx = (THEMES.indexOf(current) + 1) % THEMES.length;
    applyTheme(THEMES[nextIdx]);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', cycleTheme);
  }
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'auto');

  // ── Demo Mode Detection ─────────────────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const isDemoMode = urlParams.get('demo') === 'true' || urlParams.get('demo') === '1';

  const demoToggle = document.getElementById('demoToggle');
  const demoToggleLabel = document.getElementById('demoToggleLabel');
  const demoBanner = document.getElementById('demoBanner');
  const btnExitDemo = document.getElementById('btnExitDemo');

  if (demoToggle) {
    if (isDemoMode) {
      demoToggle.classList.add('active');
      if (demoToggleLabel) demoToggleLabel.textContent = 'Exit Demo';
      demoToggle.title = 'Click to exit demo mode and return to real setup';
    } else {
      demoToggle.classList.remove('active');
      if (demoToggleLabel) demoToggleLabel.textContent = 'Demo Mode';
      demoToggle.title = 'Click to try interactive demo walkthrough';
    }

    demoToggle.addEventListener('click', () => {
      if (isDemoMode) {
        window.location.href = window.location.pathname;
      } else {
        window.location.href = window.location.pathname + '?demo=true';
      }
    });
  }

  if (btnExitDemo) {
    btnExitDemo.addEventListener('click', () => {
      window.location.href = window.location.pathname;
    });
  }

  if (isDemoMode && demoBanner) {
    demoBanner.classList.remove('hidden');
  }

  // ── Step Navigation & Sneak Peek State ───────────────────────────────────
  let currentStep = 1;
  let maxStepReached = isDemoMode ? 4 : 1;
  let latestStep = 1;

  const STEP_NAMES = {
    1: 'Telegram Credentials',
    2: 'Code Verification',
    3: 'Music Library',
    4: 'Connect BitChord',
  };

  const panels = {
    1: document.getElementById('panelStep1'),
    2: document.getElementById('panelStep2'),
    3: document.getElementById('panelStep3'),
    4: document.getElementById('panelStep4'),
  };
  const indicators = {
    1: document.getElementById('stepIndicator1'),
    2: document.getElementById('stepIndicator2'),
    3: document.getElementById('stepIndicator3'),
    4: document.getElementById('stepIndicator4'),
  };
  const globalError = document.getElementById('globalError');
  const sneakPeekBar = document.getElementById('sneakPeekBar');
  const sneakPeekText = document.getElementById('sneakPeekText');
  const btnReturnToLatest = document.getElementById('btnReturnToLatest');
  const btnSneakPeek = document.getElementById('btnSneakPeek');

  function showError(msg) {
    if (!globalError) return;
    if (!msg) {
      globalError.classList.add('hidden');
      globalError.textContent = '';
      return;
    }
    globalError.textContent = msg;
    globalError.classList.remove('hidden');
    globalError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearError() {
    showError(null);
  }

  function updateStepIndicators() {
    for (let i = 1; i <= 4; i++) {
      const el = indicators[i];
      if (!el) continue;

      el.classList.remove('active', 'completed', 'clickable');

      if (i < currentStep) {
        el.classList.add('completed');
      } else if (i === currentStep) {
        el.classList.add('active');
      }

      if (i <= maxStepReached || isDemoMode) {
        el.classList.add('clickable');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
      }
    }
  }

  function setStep(step, isSneakPeek = false) {
    currentStep = step;
    clearError();

    if (step > maxStepReached) {
      maxStepReached = step;
    }
    if (!isSneakPeek && step > latestStep) {
      latestStep = step;
    }

    for (let i = 1; i <= 4; i++) {
      if (panels[i]) {
        if (i === step) panels[i].classList.remove('hidden');
        else panels[i].classList.add('hidden');
      }
    }

    updateStepIndicators();

    // Sneak Peek Bar logic
    if (sneakPeekBar) {
      if (latestStep > currentStep) {
        sneakPeekBar.classList.remove('hidden');
        if (sneakPeekText) {
          sneakPeekText.textContent = `Viewing Step ${step}: ${STEP_NAMES[step] || ''}`;
        }
        if (btnReturnToLatest) {
          btnReturnToLatest.textContent = `Return to Step ${latestStep} (${STEP_NAMES[latestStep] || ''}) \u2192`;
        }
      } else {
        sneakPeekBar.classList.add('hidden');
      }
    }
  }

  // Step indicator click listener for sneak peeking
  for (let i = 1; i <= 4; i++) {
    const ind = indicators[i];
    if (ind) {
      ind.addEventListener('click', () => {
        if (i <= maxStepReached || isDemoMode) {
          const isPeeking = i < latestStep;
          setStep(i, isPeeking);
        }
      });
      ind.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (i <= maxStepReached || isDemoMode) {
            const isPeeking = i < latestStep;
            setStep(i, isPeeking);
          }
        }
      });
    }
  }

  if (btnReturnToLatest) {
    btnReturnToLatest.addEventListener('click', () => {
      setStep(latestStep, false);
    });
  }

  if (btnSneakPeek) {
    btnSneakPeek.addEventListener('click', () => {
      setStep(1, true);
    });
  }

  // ── Advanced Options Toggle ─────────────────────────────────────────────
  const toggleAdvanced = document.getElementById('toggleAdvanced');
  const advancedContent = document.getElementById('advancedContent');
  if (toggleAdvanced && advancedContent) {
    toggleAdvanced.addEventListener('click', () => {
      advancedContent.classList.toggle('hidden');
      const arrow = toggleAdvanced.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = advancedContent.classList.contains('hidden') ? '\u25BC' : '\u25B2';
    });
  }

  // ── Step 1: Submit Credentials ──────────────────────────────────────────
  const formCredentials = document.getElementById('formCredentials');
  const btnSendCode = document.getElementById('btnSendCode');

  if (formCredentials) {
    if (isDemoMode) formCredentials.noValidate = true;
    formCredentials.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const inputApiId = document.getElementById('apiId');
      const inputApiHash = document.getElementById('apiHash');
      const inputPhone = document.getElementById('phoneNumber');

      let apiId = inputApiId.value.trim();
      let apiHash = inputApiHash.value.trim();
      let phoneNumber = inputPhone.value.trim();

      if (isDemoMode) {
        if (!apiId) { apiId = '1234567'; inputApiId.value = apiId; }
        if (!apiHash) { apiHash = '0123456789abcdef0123456789abcdef'; inputApiHash.value = apiHash; }
        if (!phoneNumber) { phoneNumber = '+1 555-0199'; inputPhone.value = phoneNumber; }

        btnSendCode.disabled = true;
        btnSendCode.innerHTML = '<span>Sending code...</span>';

        setTimeout(() => {
          btnSendCode.disabled = false;
          btnSendCode.innerHTML = '<span>Send Login Code</span>';
          const notice = document.getElementById('codeNotice');
          if (notice) {
            notice.textContent = `A verification code was sent to ${phoneNumber} (Use 12345 for demo).`;
          }
          setStep(2);
        }, 400);
        return;
      }

      if (!apiId || !apiHash || !phoneNumber) {
        showError('Please provide your API ID, API Hash, and phone number.');
        return;
      }

      btnSendCode.disabled = true;
      btnSendCode.innerHTML = '<span>Sending code...</span>';

      try {
        const res = await fetch('/api/setup/send-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiId, apiHash, phoneNumber }),
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Failed to send login code.');
        }

        const notice = document.getElementById('codeNotice');
        if (notice) {
          notice.textContent = `A verification code was sent to ${phoneNumber}.`;
        }

        setStep(2);
      } catch (err) {
        showError(err.message || 'Error communicating with Telegram.');
      } finally {
        btnSendCode.disabled = false;
        btnSendCode.innerHTML = '<span>Send Login Code</span>';
      }
    });
  }

  // ── Step 2: Verify Code & 2FA ───────────────────────────────────────────
  const formVerifyCode = document.getElementById('formVerifyCode');
  const btnConfirmCode = document.getElementById('btnConfirmCode');
  const twoFaContainer = document.getElementById('twoFaContainer');
  const twoFaPassword = document.getElementById('twoFaPassword');
  const btnBackToStep1 = document.getElementById('btnBackToStep1');

  if (btnBackToStep1) {
    btnBackToStep1.addEventListener('click', () => setStep(1));
  }

  let awaiting2FA = false;

  if (formVerifyCode) {
    if (isDemoMode) formVerifyCode.noValidate = true;
    formVerifyCode.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const inputPhoneCode = document.getElementById('phoneCode');

      if (isDemoMode) {
        if (!inputPhoneCode.value.trim()) {
          inputPhoneCode.value = '12345';
        }
        btnConfirmCode.disabled = true;
        btnConfirmCode.innerHTML = '<span>Verifying code...</span>';

        setTimeout(async () => {
          btnConfirmCode.disabled = false;
          btnConfirmCode.innerHTML = '<span>Verify and Continue</span>';
          await loadChannelsAndProceed();
        }, 400);
        return;
      }

      btnConfirmCode.disabled = true;

      try {
        if (!awaiting2FA) {
          const phoneCode = inputPhoneCode.value.trim();
          if (!phoneCode) {
            showError('Please enter the code sent to your Telegram app.');
            btnConfirmCode.disabled = false;
            return;
          }

          btnConfirmCode.innerHTML = '<span>Verifying code...</span>';
          const res = await fetch('/api/setup/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneCode }),
          });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Failed to verify code.');
          }

          if (data.requires2FA) {
            awaiting2FA = true;
            twoFaContainer.classList.remove('hidden');
            twoFaPassword.required = true;
            twoFaPassword.focus();
            showError('Two-step verification is enabled on your account. Please enter your password.');
            btnConfirmCode.innerHTML = '<span>Verify Password</span>';
            btnConfirmCode.disabled = false;
            return;
          }

          await loadChannelsAndProceed();
        } else {
          const password = twoFaPassword.value;
          if (!password) {
            showError('Please enter your 2FA password.');
            btnConfirmCode.disabled = false;
            return;
          }

          btnConfirmCode.innerHTML = '<span>Verifying password...</span>';
          const res = await fetch('/api/setup/verify-2fa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          const data = await res.json();

          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Invalid 2FA password.');
          }

          await loadChannelsAndProceed();
        }
      } catch (err) {
        showError(err.message || 'Verification error.');
      } finally {
        btnConfirmCode.disabled = false;
        if (!awaiting2FA) {
          btnConfirmCode.innerHTML = '<span>Verify and Continue</span>';
        } else {
          btnConfirmCode.innerHTML = '<span>Verify Password</span>';
        }
      }
    });
  }

  // ── Load Channels from Telegram ─────────────────────────────────────────
  async function loadChannelsAndProceed() {
    setStep(3);
    const channelSelect = document.getElementById('channelSelect');
    channelSelect.innerHTML = '<option value="" disabled selected>Loading your channels...</option>';

    if (isDemoMode) {
      const demoChannels = [
        { id: '-1001928374650', title: 'Lossless Music Vault', username: '@lossless_vault' },
        { id: '-1009876543210', title: 'Dolby Atmos Masters', username: '@atmos_masters' },
        { id: '-1005544332211', title: 'Personal Studio Audio FLACs' },
      ];

      channelSelect.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- Select your music channel --';
      defaultOpt.disabled = true;
      channelSelect.appendChild(defaultOpt);

      for (const ch of demoChannels) {
        const opt = document.createElement('option');
        opt.value = ch.id;
        const tag = ch.username ? ` (${ch.username})` : '';
        opt.textContent = `${ch.title}${tag}`;
        channelSelect.appendChild(opt);
      }
      channelSelect.selectedIndex = 1;

      const manualOpt = document.createElement('option');
      manualOpt.value = '__manual__';
      manualOpt.textContent = 'Custom Channel ID / Username...';
      channelSelect.appendChild(manualOpt);

      channelSelect.addEventListener('change', () => {
        const manualRow = document.getElementById('manualChannelRow');
        if (channelSelect.value === '__manual__') {
          manualRow.style.display = 'block';
          document.getElementById('manualChannel').focus();
        } else {
          manualRow.style.display = 'none';
        }
      });
      return;
    }

    try {
      const res = await fetch('/api/setup/channels');
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load channels.');
      }

      channelSelect.innerHTML = '';
      if (!data.channels || data.channels.length === 0) {
        channelSelect.innerHTML = '<option value="" disabled selected>No channels found. Enter manually below.</option>';
        document.getElementById('manualChannelRow').style.display = 'block';
        return;
      }

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- Select your music channel --';
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      channelSelect.appendChild(defaultOpt);

      for (const ch of data.channels) {
        const opt = document.createElement('option');
        opt.value = ch.id;
        const tag = ch.username ? ` (${ch.username})` : '';
        opt.textContent = `${ch.title}${tag}`;
        channelSelect.appendChild(opt);
      }

      const manualOpt = document.createElement('option');
      manualOpt.value = '__manual__';
      manualOpt.textContent = 'Custom Channel ID / Username...';
      channelSelect.appendChild(manualOpt);

      channelSelect.addEventListener('change', () => {
        const manualRow = document.getElementById('manualChannelRow');
        if (channelSelect.value === '__manual__') {
          manualRow.style.display = 'block';
          document.getElementById('manualChannel').focus();
        } else {
          manualRow.style.display = 'none';
        }
      });
    } catch (err) {
      showError('Could not auto-load channels: ' + err.message + '. You can enter your channel manually.');
      document.getElementById('manualChannelRow').style.display = 'block';
    }
  }

  // ── Step 3: Save Configuration ──────────────────────────────────────────
  const formLibrary = document.getElementById('formLibrary');
  const btnSaveConfig = document.getElementById('btnSaveConfig');
  const btnBackToStep2 = document.getElementById('btnBackToStep2');

  if (btnBackToStep2) {
    btnBackToStep2.addEventListener('click', () => setStep(2));
  }

  if (formLibrary) {
    if (isDemoMode) formLibrary.noValidate = true;
    formLibrary.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const channelSelect = document.getElementById('channelSelect');
      let chosenChannel = channelSelect.value;
      if (chosenChannel === '__manual__' || !chosenChannel) {
        chosenChannel = document.getElementById('manualChannel').value.trim();
      }

      if (!chosenChannel) {
        showError('Please select or specify your Telegram music channel.');
        return;
      }

      const enableBotSync = document.getElementById('enableBotSync').checked;
      const enableTunnel = document.getElementById('enableTunnel')?.checked ?? true;
      const customPublicUrl = document.getElementById('customPublicUrl')?.value.trim() || '';
      const urlSecret = document.getElementById('urlSecret').value.trim();
      const port = document.getElementById('serverPort').value.trim() || '3000';

      if (isDemoMode) {
        btnSaveConfig.disabled = true;
        btnSaveConfig.innerHTML = enableTunnel
          ? '<span>Simulating Cloudflare HTTPS tunnel...</span>'
          : '<span>Saving configuration...</span>';

        setTimeout(() => {
          btnSaveConfig.disabled = false;
          btnSaveConfig.innerHTML = '<span>Complete Setup</span>';
          const secretPath = urlSecret ? `/${urlSecret}` : '';
          const demoOrigin = enableTunnel
            ? 'https://telemusic-demo.trycloudflare.com'
            : (customPublicUrl || `http://localhost:${port}`);
          const demoManifestUrl = `${demoOrigin}${secretPath}/manifest.json`;
          displayFinalStep(demoManifestUrl);
        }, 500);
        return;
      }

      btnSaveConfig.disabled = true;
      btnSaveConfig.innerHTML = enableTunnel
        ? '<span>Connecting Cloudflare HTTPS tunnel...</span>'
        : '<span>Saving configuration...</span>';

      try {
        const res = await fetch('/api/setup/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: chosenChannel,
            enableBotSync,
            enableTunnel,
            customPublicUrl,
            urlSecret,
            port,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Failed to save configuration.');
        }

        displayFinalStep(data.manifestUrl);
      } catch (err) {
        showError(err.message || 'Error saving setup.');
      } finally {
        btnSaveConfig.disabled = false;
        btnSaveConfig.innerHTML = '<span>Complete Setup</span>';
      }
    });
  }

  // ── Step 4: Display Finished Addon Links & QR ───────────────────────────
  function displayFinalStep(manifestUrl) {
    latestStep = 4;
    maxStepReached = 4;
    setStep(4);

    const inputManifest = document.getElementById('manifestUrl');
    if (inputManifest) inputManifest.value = manifestUrl || '';

    const qrContainer = document.getElementById('qrCodeContainer');
    if (qrContainer && manifestUrl) {
      renderSvgQrCode(qrContainer, manifestUrl);
    }
  }

  // ── Clipboard Copy Handlers ─────────────────────────────────────────────
  function setupCopyButton(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied');
        }, 2000);
      } catch (_) {
        input.select();
        document.execCommand('copy');
      }
    });
  }

  setupCopyButton('btnCopyManifest', 'manifestUrl');

  const btnReconfigure = document.getElementById('btnReconfigure');
  if (btnReconfigure) {
    btnReconfigure.addEventListener('click', () => setStep(1));
  }

  // ── High-Precision SVG QR Code Renderer with Centered Addon Logo ─────────
  async function renderSvgQrCode(container, text) {
    container.innerHTML = '<span style="font-size:0.8125rem;color:var(--text-muted)">Generating QR...</span>';
    try {
      const res = await fetch(`/api/setup/qr?url=${encodeURIComponent(text)}`);
      if (!res.ok) throw new Error('Failed to load QR');
      const svgText = await res.text();
      container.innerHTML = svgText;
    } catch (_) {
      container.innerHTML = '<span style="font-size:0.8125rem;color:var(--text-dim)">QR unavailable</span>';
    }
  }

  // ── Initial Status Check ────────────────────────────────────────────────
  async function checkInitialStatus() {
    if (isDemoMode) {
      // In demo mode, start at Step 1 and allow free navigation across all steps
      maxStepReached = 4;
      latestStep = 1;
      setStep(1);
      return;
    }

    try {
      const res = await fetch('/api/setup/status');
      if (!res.ok) return;
      const data = await res.json();

      if (data.configured) {
        let baseOrigin = '';
        if (data.tunnelActive && data.tunnelUrl) {
          baseOrigin = data.tunnelUrl;
        } else {
          const proto = window.location.protocol;
          const host = window.location.host;
          baseOrigin = `${proto}//${host}`;
        }
        const manifestUrl = `${baseOrigin}/manifest.json`;
        displayFinalStep(manifestUrl);
      }
    } catch (_) {}
  }

  checkInitialStatus();
})();
