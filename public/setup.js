(function () {
  'use strict';

  // ── Permanent Dark Theme ────────────────────────────────────────────────
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('telemusic_theme', 'dark');

  // ── Step Navigation & State ─────────────────────────────────────────────
  let currentStep = 1;
  let isConfiguredLocked = false;
  let serverConfigData = null;
  let newCodeRequested = false;
  let awaiting2FA = false;
  let channelsLoaded = false;

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

  function updateStepIndicators() {
    const dividers = document.querySelectorAll('.step-divider');

    for (let i = 1; i <= 4; i++) {
      const el = indicators[i];
      if (!el) continue;

      const numEl = el.querySelector('.step-num');
      el.classList.remove('active', 'completed');

      if (i < currentStep) {
        el.classList.add('completed');
        if (numEl) numEl.textContent = '✓';
      } else if (i === currentStep) {
        if (currentStep === 4) {
          el.classList.add('completed');
          if (numEl) numEl.textContent = '✓';
        } else {
          el.classList.add('active');
          if (numEl) numEl.textContent = String(i);
        }
      } else {
        if (numEl) numEl.textContent = String(i);
      }
    }

    dividers.forEach((divider, idx) => {
      divider.classList.toggle('completed', idx < currentStep - 1);
    });
  }

  function setStep(step) {
    currentStep = step;
    clearError();

    for (let i = 1; i <= 4; i++) {
      if (panels[i]) {
        if (i === step) panels[i].classList.remove('hidden');
        else panels[i].classList.add('hidden');
      }
    }

    updateStepIndicators();

    if (step === 2) {
      updateStep2NextState();
    }

    // Auto-fetch channels when navigating to Step 3
    if (step === 3) {
      initChannelInput();
    }

    if (step === 4) {
      ensureStep4Rendered();
    }
  }

  // ── Lock & Unlock Configuration State ───────────────────────────────────
  function setConfigurationLock(locked) {
    isConfiguredLocked = locked;

    const inputsToLock = [
      document.getElementById('apiId'),
      document.getElementById('apiHash'),
      document.getElementById('phoneNumber'),
      document.getElementById('phoneCode'),
      document.getElementById('twoFaPassword'),
      document.getElementById('channelInput'),
      document.getElementById('enableBotSync'),
      document.getElementById('botToken'),
      document.getElementById('enableTunnel'),
      document.getElementById('urlSecret'),
      document.getElementById('customPublicUrl'),
      document.getElementById('serverPort'),
    ];

    inputsToLock.forEach((input) => {
      if (!input) return;
      input.disabled = locked;
      input.dataset.locked = locked ? 'true' : 'false';
      const formGroup = input.closest('.form-group');
      if (formGroup) formGroup.classList.toggle('is-locked', locked);
      const optionCard = input.closest('.option-card');
      if (optionCard) optionCard.classList.toggle('is-locked', locked);
    });

    const toggleAdvanced = document.getElementById('toggleAdvanced');
    if (toggleAdvanced) {
      toggleAdvanced.disabled = locked;
    }
    const advancedSection = document.getElementById('advancedSection');
    if (advancedSection) {
      advancedSection.classList.toggle('is-locked', locked);
    }

    if (locked) {
      document.querySelectorAll('.masked-credential').forEach((input) => {
        input.type = 'password';
      });
    }
  }

  // ── Navigation Buttons & Form Handlers ──────────────────────────────────
  const btnStep1Next = document.getElementById('btnStep1Next');
  const btnStep2Back = document.getElementById('btnStep2Back');
  const btnStep2Next = document.getElementById('btnStep2Next');
  const btnStep3Back = document.getElementById('btnStep3Back');
  const btnStep3Next = document.getElementById('btnStep3Next');
  const btnStep4Back = document.getElementById('btnStep4Back');
  const btnReconfigure = document.getElementById('btnReconfigure');

  // Prevent default submit on all forms
  ['formCredentials', 'formVerifyCode', 'formLibrary'].forEach((formId) => {
    const f = document.getElementById(formId);
    if (f) f.addEventListener('submit', (e) => e.preventDefault());
  });

  function hasCredentialsChanged() {
    if (!serverConfigData) return true;
    const inputApiId = document.getElementById('apiId');
    const inputApiHash = document.getElementById('apiHash');
    const inputPhone = document.getElementById('phoneNumber');

    const curId = inputApiId ? inputApiId.value.trim() : '';
    const curHash = inputApiHash ? inputApiHash.value.trim() : '';
    const curPhone = typeof getFullPhoneNumber === 'function' ? getFullPhoneNumber() : (inputPhone ? inputPhone.value.trim() : '');

    return curId !== (serverConfigData.apiId || '') ||
           curHash !== (serverConfigData.apiHash || '') ||
           (serverConfigData.phoneNumber && curPhone !== serverConfigData.phoneNumber);
  }

  // Step 1: Next (no back button on Step 1)
  if (btnStep1Next) {
    btnStep1Next.addEventListener('click', () => {
      clearError();

      const inputApiId = document.getElementById('apiId');
      const inputApiHash = document.getElementById('apiHash');

      const apiId = inputApiId ? inputApiId.value.trim() : '';
      const apiHash = inputApiHash ? inputApiHash.value.trim() : '';

      if (!apiId || !apiHash) {
        showError('Please provide both your API ID and API Hash.');
        return;
      }

      sessionStorage.setItem('setup_apiId', apiId);
      sessionStorage.setItem('setup_apiHash', apiHash);

      setStep(2);
      const inputPhone = document.getElementById('phoneNumber');
      if (inputPhone && !inputPhone.value) {
        inputPhone.focus();
      }
    });
  }

  // ── Step 2 Phone & OTP Controller ──────────────────────────────────────
  function getFullPhoneNumber() {
    const phoneInput = document.getElementById('phoneNumber');
    if (!phoneInput) return '';

    let raw = phoneInput.value.trim();
    if (!raw) return '';

    if (raw.startsWith('+')) {
      return '+' + raw.replace(/\D/g, '');
    }

    const digits = raw.replace(/\D/g, '');
    return digits ? '+' + digits : '';
  }

  function setPhoneInputFromFull(fullPhone) {
    if (!fullPhone) return;
    const phoneInput = document.getElementById('phoneNumber');
    if (!phoneInput) return;
    phoneInput.value = String(fullPhone).trim();
  }

  // ── OTP Slots Controller ────────────────────────────────────────────────
  const otpSlots = Array.from(document.querySelectorAll('.otp-slot'));
  const hiddenPhoneCode = document.getElementById('phoneCode');

  function getOtpValue() {
    return otpSlots.map((s) => s.value).join('');
  }

  function updateStep2NextState() {
    if (!btnStep2Next) return;
    if (isConfiguredLocked || (serverConfigData && serverConfigData.configured && !hasCredentialsChanged() && !newCodeRequested)) {
      btnStep2Next.disabled = false;
      return;
    }
    if (awaiting2FA) {
      const twoFaInput = document.getElementById('twoFaPassword');
      btnStep2Next.disabled = !(twoFaInput && twoFaInput.value.trim());
      return;
    }
    const otpSection = document.getElementById('otpSection');
    const isOtpVisible = otpSection && !otpSection.classList.contains('hidden');
    if (isOtpVisible || newCodeRequested) {
      btnStep2Next.disabled = getOtpValue().length !== otpSlots.length;
    } else {
      btnStep2Next.disabled = false;
    }
  }

  function syncOtpToHidden() {
    const val = getOtpValue();
    if (hiddenPhoneCode) hiddenPhoneCode.value = val;
    updateStep2NextState();
    return val;
  }

  function clearOtpSlots() {
    otpSlots.forEach((s) => {
      s.value = '';
      s.classList.remove('filled');
    });
    syncOtpToHidden();
  }

  otpSlots.forEach((slot, idx) => {
    slot.addEventListener('input', () => {
      const val = slot.value.replace(/\D/g, '');
      slot.value = val.slice(-1);
      slot.classList.toggle('filled', Boolean(slot.value));

      syncOtpToHidden();

      if (slot.value && idx < otpSlots.length - 1) {
        otpSlots[idx + 1].focus();
        otpSlots[idx + 1].select();
      }

      if (getOtpValue().length === otpSlots.length) {
        const nextBtn = document.getElementById('btnStep2Next');
        if (nextBtn) nextBtn.click();
      }
    });

    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!slot.value && idx > 0) {
          otpSlots[idx - 1].focus();
          otpSlots[idx - 1].value = '';
          otpSlots[idx - 1].classList.remove('filled');
          syncOtpToHidden();
        } else {
          slot.value = '';
          slot.classList.remove('filled');
          syncOtpToHidden();
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        otpSlots[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < otpSlots.length - 1) {
        otpSlots[idx + 1].focus();
      }
    });

    slot.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteText = (e.clipboardData || window.clipboardData).getData('text') || '';
      const digits = pasteText.replace(/\D/g, '').slice(0, otpSlots.length);
      if (!digits) return;

      digits.split('').forEach((d, i) => {
        if (otpSlots[i]) {
          otpSlots[i].value = d;
          otpSlots[i].classList.add('filled');
        }
      });

      const nextFocus = Math.min(digits.length, otpSlots.length - 1);
      if (otpSlots[nextFocus]) otpSlots[nextFocus].focus();

      syncOtpToHidden();

      if (digits.length === otpSlots.length) {
        const nextBtn = document.getElementById('btnStep2Next');
        if (nextBtn) nextBtn.click();
      }
    });
  });

  // ── Resend Countdown Timer ──────────────────────────────────────────────
  let resendCountdownTimer = null;
  function startResendCountdown(seconds = 60) {
    if (resendCountdownTimer) clearInterval(resendCountdownTimer);
    const btnResend = document.getElementById('btnResendCode');
    const noticeText = document.getElementById('resendNoticeText');
    if (!btnResend) return;

    btnResend.disabled = true;
    let remaining = seconds;
    if (noticeText) noticeText.textContent = "Didn't get the code?";
    btnResend.innerHTML = `Resend in <span id="resendTimer">${remaining}</span>s`;

    resendCountdownTimer = setInterval(() => {
      remaining -= 1;
      const t = document.getElementById('resendTimer');
      if (t) t.textContent = String(remaining);
      if (remaining <= 0) {
        clearInterval(resendCountdownTimer);
        resendCountdownTimer = null;
        btnResend.disabled = false;
        btnResend.textContent = 'Resend Code';
      }
    }, 1000);
  }

  // ── Step 2 Telegram Code Request Helper ─────────────────────────────────
  async function requestTelegramCode() {
    clearError();
    const inputApiId = document.getElementById('apiId');
    const inputApiHash = document.getElementById('apiHash');

    const apiId = inputApiId ? inputApiId.value.trim() : (serverConfigData?.apiId || '');
    const apiHash = inputApiHash ? inputApiHash.value.trim() : (serverConfigData?.apiHash || '');
    const phoneNumber = getFullPhoneNumber();

    if (!apiId || !apiHash) {
      showError('Missing API credentials. Please go back to Step 1.');
      return false;
    }
    if (!phoneNumber) {
      showError('Please enter your phone number with country code (e.g. +1... or +91...).');
      const p = document.getElementById('phoneNumber');
      if (p) p.focus();
      return false;
    }
    if (phoneNumber.replace(/\D/g, '').length < 6) {
      showError('Please enter a valid phone number including country code (e.g. +91 9876543210).');
      const p = document.getElementById('phoneNumber');
      if (p) p.focus();
      return false;
    }

    sessionStorage.setItem('setup_phoneNumber', phoneNumber);

    const btnSend = document.getElementById('btnSendCode');
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.innerHTML = '<span>Sending code...</span>';
    }

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

      newCodeRequested = true;
      const notice = document.getElementById('codeNotice');
      if (notice) {
        notice.textContent = `A verification code was sent to ${phoneNumber}.`;
      }

      if (btnSend) {
        btnSend.innerHTML = '<span>✓ Code Sent</span>';
      }

      // Reveal Stage 2 (OTP Slots)
      const otpSection = document.getElementById('otpSection');
      if (otpSection) {
        otpSection.classList.remove('hidden');
      }

      startResendCountdown(60);
      updateStep2NextState();

      // Focus first OTP slot
      if (otpSlots[0]) {
        otpSlots[0].focus();
      }
      return true;
    } catch (err) {
      showError(err.message || 'Error communicating with Telegram.');
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg><span>Send Code</span>';
      }
      return false;
    }
  }

  // Step 2: Back and Next
  if (btnStep2Back) {
    btnStep2Back.addEventListener('click', () => setStep(1));
  }

  const btnSendCode = document.getElementById('btnSendCode');
  if (btnSendCode) {
    btnSendCode.addEventListener('click', requestTelegramCode);
  }

  const btnResendCode = document.getElementById('btnResendCode');
  if (btnResendCode) {
    btnResendCode.addEventListener('click', () => {
      if (!btnResendCode.disabled) {
        clearOtpSlots();
        requestTelegramCode();
      }
    });
  }

  if (btnStep2Next) {
    btnStep2Next.addEventListener('click', async () => {
      clearError();

      // If locked or already configured and no new credentials were changed and no new code was requested: move to Step 3
      if (isConfiguredLocked || (serverConfigData && serverConfigData.configured && !hasCredentialsChanged() && !newCodeRequested)) {
        setStep(3);
        return;
      }

      const phoneCode = syncOtpToHidden();

      // If code was not yet requested and phoneCode is empty: automatically send the code
      if (!newCodeRequested && !phoneCode) {
        const sent = await requestTelegramCode();
        if (sent) {
          showError(null);
        }
        return;
      }

      if (!phoneCode && !awaiting2FA) {
        showError('Please enter the 5-digit verification code sent to Telegram.');
        if (otpSlots[0]) otpSlots[0].focus();
        return;
      }

      const twoFaContainer = document.getElementById('twoFaContainer');
      const twoFaPassword = document.getElementById('twoFaPassword');

      btnStep2Next.disabled = true;

      try {
        if (!awaiting2FA) {
          btnStep2Next.innerHTML = '<span>Verifying code...</span>';
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
            if (twoFaContainer) twoFaContainer.classList.remove('hidden');
            if (twoFaPassword) {
              twoFaPassword.required = true;
              twoFaPassword.focus();
            }
            showError('Two-step verification is enabled on your account. Please enter your password.');
            btnStep2Next.innerHTML = '<span>Verify Password</span>';
            btnStep2Next.disabled = false;
            return;
          }

          newCodeRequested = false;
          setStep(3);
        } else {
          const password = twoFaPassword ? twoFaPassword.value : '';
          if (!password) {
            showError('Please enter your 2FA password.');
            btnStep2Next.disabled = false;
            return;
          }

          btnStep2Next.innerHTML = '<span>Verifying password...</span>';
          const res = await fetch('/api/setup/verify-2fa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          const data = await res.json();

          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Invalid 2FA password.');
          }

          newCodeRequested = false;
          setStep(3);
        }
      } catch (err) {
        showError(err.message || 'Verification error.');
      } finally {
        btnStep2Next.disabled = false;
        if (!awaiting2FA) {
          btnStep2Next.innerHTML = '<span>Next</span>';
        } else {
          btnStep2Next.innerHTML = '<span>Verify Password</span>';
        }
      }
    });
  }

  // Step 3: Back and Next
  if (btnStep3Back) {
    btnStep3Back.addEventListener('click', () => setStep(2));
  }

  async function saveStep3Settings(navigateAfter = true) {
    const channelInput = document.getElementById('channelInput');
    const enableBotSync = document.getElementById('enableBotSync');
    const botToken = document.getElementById('botToken');
    const enableTunnel = document.getElementById('enableTunnel');
    const urlSecret = document.getElementById('urlSecret');
    const customPublicUrl = document.getElementById('customPublicUrl');
    const serverPort = document.getElementById('serverPort');

    let channelVal = channelInput ? channelInput.value.trim() : '';
    if (!channelVal && serverConfigData?.channel) {
      channelVal = serverConfigData.channel;
    }

    if (channelVal.startsWith('https://t.me/')) {
      channelVal = '@' + channelVal.replace('https://t.me/', '').replace('/', '').trim();
    } else if (channelVal.startsWith('t.me/')) {
      channelVal = '@' + channelVal.replace('t.me/', '').replace('/', '').trim();
    }

    if (!channelVal) {
      showError('Please enter your Telegram music channel ID, URL, or @username.');
      if (channelInput) channelInput.focus();
      return false;
    }

    const isBotSync = enableBotSync ? enableBotSync.checked : false;
    const botTokenVal = botToken ? botToken.value.trim() : '';
    if (isBotSync && !botTokenVal) {
      showError('Please enter your Bot Token or uncheck Bot Automation.');
      if (botTokenContainer) botTokenContainer.classList.remove('hidden');
      if (botToken) botToken.focus();
      return false;
    }

    if (btnStep3Next && navigateAfter) {
      btnStep3Next.disabled = true;
      btnStep3Next.innerHTML = '<span>Checking channel...</span>';
    }

    try {
      // Compute safe port with default 3000 fallback clamped between 1024 and 65535
      let safePort = 3000;
      if (serverPort && serverPort.value.trim()) {
        const parsed = parseInt(serverPort.value.trim(), 10);
        if (!isNaN(parsed) && parsed >= 1024 && parsed <= 65535) {
          safePort = parsed;
        }
      }
      if (serverPort) {
        serverPort.value = safePort;
      }

      // Validate channel with Telegram MTProto before saving
      try {
        const valRes = await fetch('/api/setup/validate-channel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: channelVal }),
        });
        const contentType = valRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          // If server returned non-JSON (e.g. 404 or restarting), bypass pre-validation check and proceed to /save
          console.warn('Channel pre-validation endpoint returned non-JSON, deferring to save handler.');
        } else {
          const valData = await valRes.json();
          if (!valRes.ok || !valData.ok) {
            showError(valData.error || 'Wrong channel ID, URL, or username. Please check that your Telegram account is a member or admin.');
            if (channelInput) channelInput.focus();
            return false;
          }
          if (valData.channel && valData.channel.id) {
            channelVal = valData.channel.id;
          }
        }
      } catch (valErr) {
        console.warn('Channel pre-validation error, attempting save:', valErr);
      }

      if (btnStep3Next && navigateAfter) {
        btnStep3Next.innerHTML = '<span>Saving...</span>';
      }

      const teledriveEl = document.getElementById('teledriveChannel');
      const teledriveVal = teledriveEl ? teledriveEl.value.trim() : (serverConfigData?.teledriveChannel || '');

      const res = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelVal,
          teledriveChannel: teledriveVal,
          enableBotSync: enableBotSync ? enableBotSync.checked : false,
          botToken: botToken ? botToken.value.trim() : '',
          enableTunnel: enableTunnel ? enableTunnel.checked : false,
          urlSecret: urlSecret ? urlSecret.value.trim() : '',
          customPublicUrl: customPublicUrl ? customPublicUrl.value.trim() : '',
          port: safePort.toString(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to save configuration.');
      }

      serverConfigData = {
        ...serverConfigData,
        configured: true,
        channel: channelVal,
        teledriveChannel: teledriveVal,
        enableBotSync: enableBotSync ? enableBotSync.checked : false,
        botToken: botToken ? botToken.value.trim() : '',
        enableTunnel: enableTunnel ? enableTunnel.checked : false,
        urlSecret: (data.config && data.config.urlSecret) || (urlSecret ? urlSecret.value.trim() : ''),
        customPublicUrl: customPublicUrl ? customPublicUrl.value.trim() : '',
        port: safePort,
      };

      if (navigateAfter) {
        setConfigurationLock(true);
        displayFinalStep(data.manifestUrl, data.tracksCount);
      }
      return true;
    } catch (err) {
      showError(err.message || 'Error saving setup.');
      return false;
    } finally {
      if (btnStep3Next && navigateAfter) {
        btnStep3Next.disabled = false;
        btnStep3Next.innerHTML = '<span>Next</span>';
      }
    }
  }

  function collapseAdvancedSection() {
    const advancedContent = document.getElementById('advancedContent');
    const toggleAdvanced = document.getElementById('toggleAdvanced');
    if (advancedContent) advancedContent.classList.add('hidden');
    if (toggleAdvanced) {
      const arrow = toggleAdvanced.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = '▼';
    }
  }

  if (btnStep3Next) {
    btnStep3Next.addEventListener('click', async () => {
      clearError();
      collapseAdvancedSection();

      // If locked: navigate straight to Step 4 without re-saving
      if (isConfiguredLocked) {
        ensureStep4Rendered();
        setStep(4);
        return;
      }

      await saveStep3Settings(true);
    });
  }

  // Step 4: Restart Server and Reconfigure
  const btnRestartServer = document.getElementById('btnRestartServer');
  if (btnRestartServer) {
    btnRestartServer.addEventListener('click', async () => {
      btnRestartServer.disabled = true;
      const originalHtml = btnRestartServer.innerHTML;
      btnRestartServer.innerHTML = '<span>Restarting...</span>';
      clearError();

      try {
        const res = await fetch('/api/setup/restart', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Restart failed');
        }

        await checkInitialStatus();

        btnRestartServer.innerHTML = '<span>✓ Restarted</span>';
        if (data && typeof data.tracksCount === 'number') {
          updateStep4TrackCount(data.tracksCount);
        }
        setTimeout(() => {
          btnRestartServer.disabled = false;
          btnRestartServer.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        showError('Restart error: ' + err.message);
        btnRestartServer.disabled = false;
        btnRestartServer.innerHTML = originalHtml;
      }
    });
  }

  if (btnReconfigure) {
    btnReconfigure.addEventListener('click', () => {
      setConfigurationLock(false);
      setStep(1);
    });
  }

  // ── Credential Masking (Dots Unfocused, Plaintext When Focused) ─────────
  const maskedInputs = document.querySelectorAll('.masked-credential');
  maskedInputs.forEach((input) => {
    input.addEventListener('focus', () => {
      if (input.dataset.locked !== 'true') {
        input.type = 'text';
      }
    });

    input.addEventListener('blur', () => {
      input.type = 'password';
    });

    input.addEventListener('input', () => {
      if (input.id) {
        sessionStorage.setItem('setup_' + input.id, input.value);
        if (input.id === 'phoneNumber') {
          clearError();
        }
        if (input.id === 'twoFaPassword') {
          updateStep2NextState();
        }
      }
    });
  });

  // Safe port input handling: fallback to 3000 if emptied or invalid
  const serverPortEl = document.getElementById('serverPort');
  if (serverPortEl) {
    serverPortEl.addEventListener('blur', () => {
      const val = serverPortEl.value.trim();
      const parsed = parseInt(val, 10);
      if (!val || isNaN(parsed) || parsed < 1024 || parsed > 65535) {
        serverPortEl.value = '3000';
      }
    });
  }

  ['channelInput', 'customPublicUrl', 'serverPort'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => sessionStorage.setItem('setup_' + id, el.value));
      el.addEventListener('change', () => sessionStorage.setItem('setup_' + id, el.value));
    }
  });

  // ── Advanced Options Toggle ─────────────────────────────────────────────
  const toggleAdvanced = document.getElementById('toggleAdvanced');
  const advancedContent = document.getElementById('advancedContent');
  if (toggleAdvanced && advancedContent) {
    toggleAdvanced.addEventListener('click', () => {
      if (isConfiguredLocked) return;
      advancedContent.classList.toggle('hidden');
      const arrow = toggleAdvanced.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = advancedContent.classList.contains('hidden') ? '\u25BC' : '\u25B2';
    });
  }

  // ── Bot Automation & Tunnel Toggles ────────────────────────────────────
  const enableBotSync = document.getElementById('enableBotSync');
  const botTokenContainer = document.getElementById('botTokenContainer');
  if (enableBotSync) {
    enableBotSync.addEventListener('change', () => {
      if (botTokenContainer) botTokenContainer.classList.toggle('hidden', !enableBotSync.checked);
      sessionStorage.setItem('setup_enableBotSync', enableBotSync.checked ? 'true' : 'false');
    });
  }

  const enableTunnel = document.getElementById('enableTunnel');
  if (enableTunnel) {
    enableTunnel.addEventListener('change', () => {
      sessionStorage.setItem('setup_enableTunnel', enableTunnel.checked ? 'true' : 'false');
    });
  }

  // ── Step 3: Initialize Channel Input ─────────────────────────────────────
  function initChannelInput() {
    const channelInput = document.getElementById('channelInput');
    if (!channelInput) return;

    const savedChannel = sessionStorage.getItem('setup_channelInput') || serverConfigData?.channel;
    if (savedChannel && !channelInput.value) {
      channelInput.value = savedChannel;
    }

    channelInput.addEventListener('input', () => {
      sessionStorage.setItem('setup_channelInput', channelInput.value.trim());
      clearError();
    });

    if (isConfiguredLocked) {
      channelInput.disabled = true;
    }
  }

  function updateStep4TrackCount(count) {
    const el = document.getElementById('step4TrackStatus');
    if (!el) return;
    if (typeof count === 'number' && count >= 0) {
      el.textContent = `Online • ${count.toLocaleString()} Tracks Indexed`;
    } else if (count) {
      el.textContent = `Online • ${count} Tracks Indexed`;
    } else {
      el.textContent = 'Online • Ready to Stream';
    }
  }

  // ── Step 4: Display Finished Addon Links & QR ───────────────────────────
  function ensureStep4Rendered() {
    const inputManifest = document.getElementById('manifestUrl');
    let manifestUrl = inputManifest ? inputManifest.value.trim() : '';

    if (!manifestUrl) {
      let baseOrigin = '';
      if (serverConfigData?.customPublicUrl) {
        baseOrigin = serverConfigData.customPublicUrl;
      } else if (serverConfigData?.enableTunnel && serverConfigData?.tunnelActive && serverConfigData?.tunnelUrl) {
        baseOrigin = serverConfigData.tunnelUrl;
      } else {
        const proto = window.location.protocol;
        const host = window.location.host;
        baseOrigin = `${proto}//${host}`;
      }
      const secretPath = serverConfigData?.urlSecret ? `/${serverConfigData.urlSecret}` : '';
      manifestUrl = `${baseOrigin}${secretPath}/manifest.json`;
      if (inputManifest) inputManifest.value = manifestUrl;
    }

    const inputWebdav = document.getElementById('webdavUrl');
    if (inputWebdav && manifestUrl) {
      inputWebdav.value = manifestUrl.replace(/\/manifest\.json$/, '/dav');
    }

    const qrContainer = document.getElementById('qrCodeContainer');
    if (qrContainer && manifestUrl && (!qrContainer.querySelector('svg') || qrContainer.dataset.renderedUrl !== manifestUrl)) {
      qrContainer.dataset.renderedUrl = manifestUrl;
      renderSvgQrCode(qrContainer, manifestUrl);
    }

    if (serverConfigData && typeof serverConfigData.tracksCount === 'number') {
      updateStep4TrackCount(serverConfigData.tracksCount);
    }
  }

  function displayFinalStep(manifestUrl, tracksCount) {
    const inputManifest = document.getElementById('manifestUrl');
    if (inputManifest && manifestUrl) {
      inputManifest.value = manifestUrl;
    }

    const inputWebdav = document.getElementById('webdavUrl');
    if (inputWebdav && manifestUrl) {
      inputWebdav.value = manifestUrl.replace(/\/manifest\.json$/, '/dav');
    }

    setStep(4);

    const qrContainer = document.getElementById('qrCodeContainer');
    if (qrContainer && manifestUrl) {
      qrContainer.dataset.renderedUrl = manifestUrl;
      renderSvgQrCode(qrContainer, manifestUrl);
    }

    if (typeof tracksCount === 'number') {
      updateStep4TrackCount(tracksCount);
    } else if (serverConfigData && typeof serverConfigData.tracksCount === 'number') {
      updateStep4TrackCount(serverConfigData.tracksCount);
    }

    if (manifestUrl) {
      fetch(manifestUrl, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          if (m && m.version) {
            const match = m.version.match(/•\s*(\d[\d,]*)\s*songs?/i);
            if (match) {
              updateStep4TrackCount(parseInt(match[1].replace(/,/g, ''), 10));
            }
          }
        })
        .catch(() => {});
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
        const textSpan = btn.querySelector('span');
        const origText = textSpan ? textSpan.textContent : btn.textContent;
        if (textSpan) textSpan.textContent = 'Copied!';
        else btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          if (textSpan) textSpan.textContent = origText;
          else btn.textContent = origText;
          btn.classList.remove('copied');
        }, 2000);
      } catch (_) {
        input.select();
        document.execCommand('copy');
      }
    });
  }

  setupCopyButton('btnCopyManifest', 'manifestUrl');
  setupCopyButton('btnCopyWebdav', 'webdavUrl');

  // ── SVG QR Code Renderer (Clean Standard QR, Cache-Busted) ──────────────
  async function renderSvgQrCode(container, text) {
    if (!container || !text) return;
    container.innerHTML = '<span style="font-size:0.8125rem;color:#0b1329;font-weight:600">Generating QR...</span>';
    try {
      const res = await fetch(`/api/setup/qr?url=${encodeURIComponent(text)}&t=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to load QR');
      const svgText = await res.text();
      container.innerHTML = svgText;
    } catch (_) {
      container.innerHTML = '<span style="font-size:0.8125rem;color:#e11d48;font-weight:600">QR unavailable</span>';
    }
  }

  // ── Restore Fields & Initial Status Check ────────────────────────────────
  function restoreSessionStorageFields() {
    const fieldIds = [
      'apiId',
      'apiHash',
      'phoneNumber',
      'channelInput',
      'botToken',
      'urlSecret',
      'customPublicUrl',
      'serverPort',
    ];
    fieldIds.forEach((id) => {
      const val = sessionStorage.getItem('setup_' + id);
      const el = document.getElementById(id);
      if (el && val) {
        if (id === 'phoneNumber') {
          setPhoneInputFromFull(val);
        } else {
          el.value = val;
        }
      }
    });
  }

  async function checkInitialStatus() {
    restoreSessionStorageFields();

    try {
      const res = await fetch('/api/setup/status');
      if (!res.ok) return;
      const data = await res.json();
      serverConfigData = data;

      const populate = (id, val) => {
        const el = document.getElementById(id);
        if (el && val && !el.value) {
          el.value = val;
        }
      };

      populate('apiId', data.apiId);
      populate('apiHash', data.apiHash);
      if (data.phoneNumber) {
        setPhoneInputFromFull(data.phoneNumber);
      }
      populate('channelInput', data.channel);
      populate('botToken', data.botToken);
      populate('urlSecret', data.urlSecret);
      populate('customPublicUrl', data.customPublicUrl);
      if (data.port) populate('serverPort', String(data.port));

      // Reflect saved TeleDrive Channel
      if (data.teledriveChannel) {
        const tdEl = document.getElementById('teledriveChannel');
        if (tdEl) tdEl.value = data.teledriveChannel;
      }

      // Reflect saved Bot Automation state & Token box visibility
      const syncCheck = document.getElementById('enableBotSync');
      if (syncCheck) {
        syncCheck.checked = Boolean(data.enableBotSync);
        if (botTokenContainer) {
          botTokenContainer.classList.toggle('hidden', !data.enableBotSync);
        }
      }

      // Reflect saved Cloudflare Tunnel state
      const tunnelCheck = document.getElementById('enableTunnel');
      if (tunnelCheck && data.enableTunnel !== undefined) {
        tunnelCheck.checked = Boolean(data.enableTunnel);
      }

      // Keep advanced section collapsed by default
      collapseAdvancedSection();

      if (data.configured) {
        setConfigurationLock(true);

        let baseOrigin = '';
        if (data.customPublicUrl) {
          baseOrigin = data.customPublicUrl;
        } else if (data.enableTunnel && data.tunnelActive && data.tunnelUrl) {
          baseOrigin = data.tunnelUrl;
        } else {
          const proto = window.location.protocol;
          const host = window.location.host;
          baseOrigin = `${proto}//${host}`;
        }
        const secretPath = data.urlSecret ? `/${data.urlSecret}` : '';
        const manifestUrl = `${baseOrigin}${secretPath}/manifest.json`;
        displayFinalStep(manifestUrl, data.tracksCount);
      } else {
        const fieldIds = ['apiId', 'apiHash', 'phoneNumber', 'channelInput', 'teledriveChannel', 'botToken', 'urlSecret', 'customPublicUrl', 'serverPort'];
        fieldIds.forEach((id) => sessionStorage.removeItem('setup_' + id));
        document.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])').forEach((input) => {
          if (input.id === 'serverPort') {
            input.value = '3000';
          } else {
            input.value = '';
          }
        });
        if (data.urlSecret) {
          const secretEl = document.getElementById('urlSecret');
          if (secretEl) secretEl.value = data.urlSecret;
        }
        setStep(1);
        setConfigurationLock(false);
      }
    } catch (_) {}
  }

  checkInitialStatus();
})();
