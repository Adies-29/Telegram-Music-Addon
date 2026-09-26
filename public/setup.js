(function () {
  'use strict';

  // ── Theme Switcher (Auto, Dark, Light) ──────────────────────────────────
  const THEME_STORAGE_KEY = 'telemusic_theme';
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');

  const THEMES = ['auto', 'dark', 'light'];
  const THEME_DATA = {
    auto: { label: 'Auto', icon: '🌓' },
    dark: { label: 'Dark', icon: '🌙' },
    light: { label: 'Light', icon: '☀️' },
  };

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'auto';
    document.documentElement.setAttribute('data-theme', theme);
    themeLabel.textContent = THEME_DATA[theme].label;
    themeIcon.textContent = THEME_DATA[theme].icon;
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

  // ── Step Navigation ─────────────────────────────────────────────────────
  let currentStep = 1;
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

  function setStep(step) {
    currentStep = step;
    clearError();

    for (let i = 1; i <= 4; i++) {
      if (panels[i]) {
        if (i === step) panels[i].classList.remove('hidden');
        else panels[i].classList.add('hidden');
      }
      if (indicators[i]) {
        indicators[i].classList.remove('active', 'completed');
        if (i < step) indicators[i].classList.add('completed');
        else if (i === step) indicators[i].classList.add('active');
      }
    }
  }

  // ── Advanced Options Toggle ─────────────────────────────────────────────
  const toggleAdvanced = document.getElementById('toggleAdvanced');
  const advancedContent = document.getElementById('advancedContent');
  if (toggleAdvanced && advancedContent) {
    toggleAdvanced.addEventListener('click', () => {
      advancedContent.classList.toggle('hidden');
      const arrow = toggleAdvanced.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = advancedContent.classList.contains('hidden') ? '▼' : '▲';
    });
  }

  // ── Step 1: Submit Credentials ──────────────────────────────────────────
  const formCredentials = document.getElementById('formCredentials');
  const btnSendCode = document.getElementById('btnSendCode');

  if (formCredentials) {
    formCredentials.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const apiId = document.getElementById('apiId').value.trim();
      const apiHash = document.getElementById('apiHash').value.trim();
      const phoneNumber = document.getElementById('phoneNumber').value.trim();

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
    formVerifyCode.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      btnConfirmCode.disabled = true;

      try {
        if (!awaiting2FA) {
          const phoneCode = document.getElementById('phoneCode').value.trim();
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
      const urlSecret = document.getElementById('urlSecret').value.trim();
      const port = document.getElementById('serverPort').value.trim();

      btnSaveConfig.disabled = true;
      btnSaveConfig.innerHTML = '<span>Saving configuration...</span>';

      try {
        const res = await fetch('/api/setup/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: chosenChannel,
            enableBotSync,
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

  // ── Initial Status Check ────────────────────────────────────────────────
  async function checkInitialStatus() {
    try {
      const res = await fetch('/api/setup/status');
      if (!res.ok) return;
      const data = await res.json();

      if (data.configured) {
        const proto = window.location.protocol;
        const host = window.location.host;
        const manifestUrl = `${proto}//${host}/manifest.json`;
        displayFinalStep(manifestUrl);
      }
    } catch (_) {}
  }

  checkInitialStatus();

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
})();
