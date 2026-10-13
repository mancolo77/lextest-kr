/**
 * LexTest КР - Премиальная система подготовки кандидатов на должности судей Кыргызской Республики
 * База данных: 4 332 вопроса по 21 отрасли права
 * Логика приложения: Экзамен, Тренировка, Марафон, База вопросов, Статистика и Банк ошибок
 */

(() => {
  'use strict';

  // =========================================================================
  // 1. STATE & STORAGE MANAGEMENT
  // =========================================================================
  const STORAGE_KEY = 'lextest_kr_v1_store';

  const defaultStorage = {
    settings: {
      theme: 'dark',
      sound: true,
      shuffleOptions: true,
      instantFeedback: false,
      fontSizeQ: 1.15 // rem
    },
    mistakes: {}, // { [qId]: { wrongCount: number, lastWrongAt: timestamp } }
    bookmarks: {}, // { [qId]: true }
    solvedStats: {}, // { [qId]: { solved: number, correct: number } }
    examHistory: [], // [ { date, total, score, passed, timeSeconds } ]
    marathonRecord: 0
  };

  let store = loadStore();

  function loadStore() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return Object.assign({}, defaultStorage, JSON.parse(data));
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
    return Object.assign({}, defaultStorage);
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  // App Global Runtime State
  const App = {
    database: null,
    sectionsMap: {},
    activeViewId: 'view-exam-setup',
    
    // Active Test / Exam State
    currentTest: {
      mode: 'exam', // 'exam' | 'practice' | 'marathon' | 'mistakes' | 'bookmarks'
      questions: [],
      currentIndex: 0,
      userAnswers: {}, // { [index]: selectedOptionIndex }
      flags: new Set(),
      timerTotalSeconds: 0,
      timerSecondsRemaining: 0,
      timerInterval: null,
      startTime: 0,
      endTime: 0,
      isFinished: false,
      instantFeedback: false,
      shuffleOptions: true,
      // Marathon specific
      marathonLives: 3,
      marathonStreak: 0,
      marathonScore: 0
    },

    // Search state
    search: {
      query: '',
      sectionId: 'all',
      filteredQuestions: [],
      displayCount: 30
    }
  };

  // =========================================================================
  // 2. AUDIO SYNTHESIS ENGINE (Web Audio API)
  // =========================================================================
  const AudioEngine = {
    ctx: null,

    init() {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    playTone(freq, type = 'sine', duration = 0.1, startDelay = 0, gainValue = 0.08) {
      if (!store.settings.sound) return;
      try {
        this.init();
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startDelay);

        gain.gain.setValueAtTime(gainValue, this.ctx.currentTime + startDelay);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startDelay + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + startDelay);
        osc.stop(this.ctx.currentTime + startDelay + duration);
      } catch (e) {
        // Audio error silent fallback
      }
    },

    click() {
      this.playTone(600, 'triangle', 0.04, 0, 0.04);
    },

    correct() {
      // Pleasant bright chord
      this.playTone(523.25, 'sine', 0.12, 0, 0.08); // C5
      this.playTone(659.25, 'sine', 0.14, 0.08, 0.08); // E5
      this.playTone(783.99, 'sine', 0.22, 0.16, 0.09); // G5
    },

    wrong() {
      // Low dual thud
      this.playTone(240, 'triangle', 0.14, 0, 0.1);
      this.playTone(180, 'triangle', 0.2, 0.08, 0.1);
    },

    finishFanfare() {
      // Fanfare arpeggio
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        this.playTone(freq, 'sine', 0.25, idx * 0.1, 0.1);
      });
    }
  };

  // =========================================================================
  // 3. CONFETTI CELEBRATION ENGINE
  // =========================================================================
  const Confetti = {
    canvas: null,
    ctx: null,
    particles: [],
    animationId: null,

    init() {
      this.canvas = document.getElementById('confetti-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },

    resize() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    fire(durationMs = 3500) {
      if (!this.canvas) return;
      this.particles = [];
      const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#3b82f6'];

      for (let i = 0; i < 150; i++) {
        this.particles.push({
          x: window.innerWidth * 0.5 + (Math.random() - 0.5) * 200,
          y: window.innerHeight * 0.4,
          w: Math.random() * 9 + 4,
          h: Math.random() * 5 + 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          vx: (Math.random() - 0.5) * 16,
          vy: Math.random() * -14 - 4,
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 10,
          opacity: 1
        });
      }

      const start = performance.now();
      if (this.animationId) cancelAnimationFrame(this.animationId);

      const update = (time) => {
        const elapsed = time - start;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.35; // gravity
          p.rotation += p.rotationSpeed;

          this.ctx.save();
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate((p.rotation * Math.PI) / 180);
          this.ctx.fillStyle = p.color;
          this.ctx.globalAlpha = p.opacity;
          this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          this.ctx.restore();
        });

        if (elapsed < durationMs) {
          this.animationId = requestAnimationFrame(update);
        } else {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
      };

      this.animationId = requestAnimationFrame(update);
    }
  };

  // =========================================================================
  // 4. TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(message, type = 'info', iconSvg = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'success') toast.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    if (type === 'danger') toast.style.borderColor = 'rgba(239, 68, 68, 0.4)';

    let icon = iconSvg;
    if (!icon) {
      if (type === 'success') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      } else if (type === 'danger') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      } else {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      }
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // =========================================================================
  // 5. DATA LOADER & BOOTSTRAP
  // =========================================================================
  async function initApplication() {
    Confetti.init();
    applyTheme(store.settings.theme);
    applySoundState(store.settings.sound);
    applyFontSize(store.settings.fontSizeQ);

    // Load data from window.TEST_DATA or fetch questions.json
    if (window.TEST_DATA) {
      App.database = window.TEST_DATA;
      onDataLoaded();
    } else {
      try {
        const resp = await fetch('questions.json');
        App.database = await resp.json();
        onDataLoaded();
      } catch (err) {
        console.error('Failed to load questions database:', err);
        showToast('Ошибка загрузки базы вопросов: ' + err.message, 'danger');
      }
    }
  }

  function onDataLoaded() {
    if (!App.database || !App.database.questions) return;

    // Index sections
    App.database.sections.forEach(sec => {
      App.sectionsMap[sec.id] = sec;
    });

    document.getElementById('total-q-badge').textContent = `${App.database.total.toLocaleString('ru-RU')} вопросов`;

    // Populate topics in Practice View
    renderPracticeTopics();

    // Populate topics in Search View Dropdown
    populateSearchSectionsDropdown();

    // Initial Search Run
    executeSearch();

    // Update Header Badges & Stats
    updateMistakesCountBadge();
    renderStatsDashboard();

    // Setup Event Listeners
    setupEventListeners();
  }

  // =========================================================================
  // 6. VIEW NAVIGATION ROUTER
  // =========================================================================
  function switchView(targetViewId) {
    if (App.activeViewId === targetViewId) return;

    // Stop active timer if leaving active test runner
    if (App.activeViewId === 'view-test-runner' && targetViewId !== 'view-test-results') {
      if (App.currentTest.timerInterval) {
        clearInterval(App.currentTest.timerInterval);
      }
    }

    // Toggle navigation tab active states
    document.querySelectorAll('.nav-tab').forEach(tab => {
      const view = tab.getAttribute('data-view');
      const isActive = view === targetViewId;
      tab.classList.toggle('active', isActive);
      if (isActive && tab.scrollIntoView) {
        try {
          tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) {}
      }
    });

    // Close mobile question palette if open
    closeMobilePalette();

    // Toggle views
    document.querySelectorAll('.view').forEach(view => {
      if (view.id === targetViewId) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    App.activeViewId = targetViewId;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Refresh view specific data
    if (targetViewId === 'view-stats') {
      renderStatsDashboard();
    } else if (targetViewId === 'view-practice') {
      renderPracticeTopics();
    }
  }

  // =========================================================================
  // 7. EXAM & TEST ENGINE
  // =========================================================================
  function startTest(config) {
    AudioEngine.click();

    let questionPool = [];

    if (config.mode === 'mistakes') {
      // Questions from error bank
      const errIds = Object.keys(store.mistakes).map(Number);
      if (errIds.length === 0) {
        showToast('В банке ошибок нет вопросов!', 'info');
        return;
      }
      questionPool = App.database.questions.filter(q => errIds.includes(q.id));
    } else if (config.mode === 'bookmarks') {
      // Questions from favorites
      const bookIds = Object.keys(store.bookmarks).map(Number);
      if (bookIds.length === 0) {
        showToast('В избранном нет вопросов!', 'info');
        return;
      }
      questionPool = App.database.questions.filter(q => bookIds.includes(q.id));
    } else if (config.mode === 'practice') {
      // Selected sections
      if (!config.sectionIds || config.sectionIds.length === 0) {
        showToast('Выберите хотя бы одну тему для тренировки!', 'danger');
        return;
      }
      questionPool = App.database.questions.filter(q => config.sectionIds.includes(q.secId));
    } else if (config.mode === 'marathon') {
      // Marathon: all questions shuffled
      questionPool = shuffleArray([...App.database.questions]);
    } else {
      // Standard Exam Mode
      const count = config.qCount || 100;

      if (config.selectionMode === 'balanced') {
        // Balanced distribution across all 21 categories
        questionPool = selectBalancedQuestions(count);
      } else if (config.selectionMode === 'weak') {
        // Prioritize questions from mistake bank
        const errIds = new Set(Object.keys(store.mistakes).map(Number));
        const errorQuestions = App.database.questions.filter(q => errIds.has(q.id));
        const remainingQuestions = App.database.questions.filter(q => !errIds.has(q.id));

        const pool = [...shuffleArray(errorQuestions), ...shuffleArray(remainingQuestions)];
        questionPool = pool.slice(0, count);
      } else {
        // Random
        questionPool = shuffleArray([...App.database.questions]).slice(0, count);
      }
    }

    if (questionPool.length === 0) {
      showToast('Нет доступных вопросов для выбранных критериев.', 'danger');
      return;
    }

    // Prepare active test question objects (with randomized options if enabled)
    const testQuestions = questionPool.map(originalQ => {
      let opts = originalQ.opts.map((optText, optIdx) => ({
        originalIndex: optIdx,
        text: optText,
        isCorrect: optIdx === originalQ.ans
      }));

      if (config.shuffleOptions) {
        opts = shuffleArray(opts);
      }

      return {
        id: originalQ.id,
        secId: originalQ.secId,
        num: originalQ.num,
        question: originalQ.q,
        options: opts,
        originalAns: originalQ.ans
      };
    });

    // Reset current test runtime
    App.currentTest = {
      mode: config.mode,
      questions: testQuestions,
      currentIndex: 0,
      userAnswers: {},
      flags: new Set(),
      timerTotalSeconds: config.timeLimitMinutes * 60,
      timerSecondsRemaining: config.timeLimitMinutes * 60,
      timerInterval: null,
      startTime: Date.now(),
      endTime: 0,
      isFinished: false,
      instantFeedback: !!config.instantFeedback,
      shuffleOptions: !!config.shuffleOptions,
      // Marathon fields
      marathonLives: 3,
      marathonStreak: 0,
      marathonScore: 0
    };

    // Setup timer if enabled
    if (App.currentTest.timerTotalSeconds > 0) {
      document.getElementById('test-timer-badge').style.display = 'inline-flex';
      startTimer();
    } else {
      document.getElementById('test-timer-badge').style.display = 'none';
    }

    // Switch to test runner view
    switchView('view-test-runner');

    // Build Question Navigation Sidebar Grid
    renderQuestionNavigator();

    // Render First Question
    renderActiveQuestion();
  }

  function selectBalancedQuestions(targetCount) {
    const totalSecs = App.database.sections.length;
    const perSec = Math.floor(targetCount / totalSecs);
    let remainder = targetCount % totalSecs;

    let selected = [];

    App.database.sections.forEach(sec => {
      const secQuestions = shuffleArray(App.database.questions.filter(q => q.secId === sec.id));
      const takeCount = perSec + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      selected.push(...secQuestions.slice(0, takeCount));
    });

    return shuffleArray(selected).slice(0, targetCount);
  }

  function startTimer() {
    if (App.currentTest.timerInterval) clearInterval(App.currentTest.timerInterval);

    updateTimerDisplay();

    App.currentTest.timerInterval = setInterval(() => {
      App.currentTest.timerSecondsRemaining--;
      updateTimerDisplay();

      if (App.currentTest.timerSecondsRemaining <= 0) {
        clearInterval(App.currentTest.timerInterval);
        showToast('Время экзамена истекло! Тест автоматически завершен.', 'danger');
        finishTest();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const s = App.currentTest.timerSecondsRemaining;
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    const timerElem = document.getElementById('test-timer-text');
    const badge = document.getElementById('test-timer-badge');

    if (timerElem) {
      timerElem.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    if (badge) {
      // Red warning if less than 5 minutes remain
      badge.classList.toggle('warning', s <= 300);
    }
  }

  function renderActiveQuestion() {
    const test = App.currentTest;
    const qIndex = test.currentIndex;
    const qData = test.questions[qIndex];
    if (!qData) return;

    // Header counter and progress bar
    const totalQ = test.questions.length;
    const counterElem = document.getElementById('test-q-counter');
    const progressFill = document.getElementById('test-progress-fill');
    
    if (counterElem) {
      counterElem.textContent = `Вопрос ${qIndex + 1} из ${totalQ}`;
    }
    if (progressFill) {
      progressFill.style.width = `${((qIndex + 1) / totalQ) * 100}%`;
    }

    // Section Badge
    const sec = App.sectionsMap[qData.secId];
    const topicBadge = document.getElementById('question-topic-badge');
    if (topicBadge && sec) {
      topicBadge.textContent = `${sec.code}. ${sec.name}`;
    }

    // Question Text
    const qTextElem = document.getElementById('active-question-text');
    if (qTextElem) {
      qTextElem.textContent = `${qData.num}. ${qData.question}`;
    }

    // Bookmark & Flag buttons state
    const isBookmarked = !!store.bookmarks[qData.id];
    const isFlagged = test.flags.has(qIndex);
    const btnBookmark = document.getElementById('btn-toggle-bookmark');
    const btnFlag = document.getElementById('btn-toggle-flag');

    if (btnBookmark) btnBookmark.classList.toggle('flagged', isBookmarked);
    if (btnFlag) btnFlag.classList.toggle('flagged', isFlagged);

    // Options Rendering
    const optionsContainer = document.getElementById('active-options-list');
    optionsContainer.innerHTML = '';

    const userAnswer = test.userAnswers[qIndex];
    const isAnswered = userAnswer !== undefined;
    const showFeedback = test.instantFeedback && isAnswered;

    const optLetters = ['A', 'B', 'C', 'D', 'E', 'F'];

    qData.options.forEach((opt, optIndex) => {
      const optElem = document.createElement('div');
      optElem.className = 'option-item';

      if (isAnswered && userAnswer === optIndex) {
        optElem.classList.add('selected');
      }

      if (showFeedback) {
        optElem.classList.add('disabled');
        if (opt.isCorrect) {
          optElem.classList.add('correct');
        } else if (userAnswer === optIndex) {
          optElem.classList.add('wrong');
        }
      }

      optElem.innerHTML = `
        <div class="option-key">${optLetters[optIndex] || (optIndex + 1)}</div>
        <div class="option-text">${escapeHtml(opt.text)}</div>
        <div class="option-indicator"></div>
      `;

      optElem.addEventListener('click', () => {
        if (showFeedback) return; // already locked
        selectOption(optIndex);
      });

      optionsContainer.appendChild(optElem);
    });

    // Explanation Box
    const explanationBox = document.getElementById('answer-explanation-box');
    if (explanationBox) {
      if (showFeedback) {
        const isCorrect = qData.options[userAnswer].isCorrect;
        explanationBox.style.display = 'flex';
        explanationBox.classList.toggle('is-wrong', !isCorrect);

        const expTitle = document.getElementById('explanation-title');
        const expDesc = document.getElementById('explanation-desc');
        const expIcon = document.getElementById('explanation-icon');

        if (isCorrect) {
          expIcon.textContent = '✓';
          expTitle.textContent = 'Верный ответ!';
          expDesc.textContent = 'Отличная работа! Ваш ответ полностью совпадает с официальным ключом.';
        } else {
          expIcon.textContent = '✕';
          expTitle.textContent = 'Неверно!';
          const correctOpt = qData.options.find(o => o.isCorrect);
          expDesc.textContent = `Правильный ответ: "${correctOpt ? correctOpt.text : ''}". Вопрос добавлен в Банк ошибок.`;
        }
      } else {
        explanationBox.style.display = 'none';
      }
    }

    // Previous button visibility
    const btnPrev = document.getElementById('btn-prev-q');
    if (btnPrev) {
      btnPrev.disabled = qIndex === 0;
      btnPrev.style.opacity = qIndex === 0 ? '0.5' : '1';
    }

    // Next button label
    const btnNext = document.getElementById('btn-next-q');
    if (btnNext) {
      if (qIndex === totalQ - 1) {
        btnNext.innerHTML = `<span>Завершить тест</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      } else {
        btnNext.innerHTML = `<span>Далее</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
      }
    }

    // Update Question Navigator item state
    updateQuestionNavigatorActive();
  }

  function selectOption(optionIndex) {
    const test = App.currentTest;
    const qIndex = test.currentIndex;
    const qData = test.questions[qIndex];
    if (!qData) return;

    test.userAnswers[qIndex] = optionIndex;
    const isCorrect = qData.options[optionIndex].isCorrect;

    // Track question statistics in LocalStorage
    recordQuestionAttempt(qData.id, isCorrect);

    // Audio Feedback
    if (test.instantFeedback) {
      if (isCorrect) AudioEngine.correct();
      else AudioEngine.wrong();
    } else {
      AudioEngine.click();
    }

    // Marathon Mode handling
    if (test.mode === 'marathon') {
      if (!isCorrect) {
        test.marathonLives--;
        AudioEngine.wrong();
        if (test.marathonLives <= 0) {
          finishMarathon();
          return;
        }
      } else {
        test.marathonScore++;
        test.marathonStreak++;
        if (test.marathonScore > store.marathonRecord) {
          store.marathonRecord = test.marathonScore;
          saveStore();
        }
      }
    }

    // Re-render question to show selected/feedback
    renderActiveQuestion();
    renderQuestionNavigator();
  }

  function renderQuestionNavigator() {
    const test = App.currentTest;
    const grid = document.getElementById('q-nav-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const totalQ = test.questions.length;
    let answeredCount = 0;

    for (let i = 0; i < totalQ; i++) {
      const btn = document.createElement('button');
      btn.className = 'q-nav-btn';
      btn.textContent = i + 1;

      const isAnswered = test.userAnswers[i] !== undefined;
      const isFlagged = test.flags.has(i);

      if (isAnswered) {
        answeredCount++;
        btn.classList.add('answered');

        if (test.instantFeedback) {
          const isCorrect = test.questions[i].options[test.userAnswers[i]].isCorrect;
          btn.classList.add(isCorrect ? 'correct' : 'wrong');
        }
      }

      if (isFlagged) {
        btn.classList.add('flagged');
      }

      if (i === test.currentIndex) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        AudioEngine.click();
        test.currentIndex = i;
        renderActiveQuestion();
        closeMobilePalette();
      });

      grid.appendChild(btn);
    }

    const statElem = document.getElementById('q-nav-answered-stat');
    if (statElem) {
      statElem.textContent = `${answeredCount} / ${totalQ}`;
    }
  }

  function updateQuestionNavigatorActive() {
    const test = App.currentTest;
    const buttons = document.querySelectorAll('.q-nav-btn');
    buttons.forEach((btn, idx) => {
      btn.classList.toggle('active', idx === test.currentIndex);
    });
  }

  function nextQuestion() {
    const test = App.currentTest;
    if (test.currentIndex < test.questions.length - 1) {
      AudioEngine.click();
      test.currentIndex++;
      renderActiveQuestion();
    } else {
      // Reached the end: confirm finish
      showConfirmFinishModal();
    }
  }

  function prevQuestion() {
    const test = App.currentTest;
    if (test.currentIndex > 0) {
      AudioEngine.click();
      test.currentIndex--;
      renderActiveQuestion();
    }
  }

  function toggleActiveBookmark() {
    const test = App.currentTest;
    const qData = test.questions[test.currentIndex];
    if (!qData) return;

    if (store.bookmarks[qData.id]) {
      delete store.bookmarks[qData.id];
      showToast('Удалено из избранного', 'info');
    } else {
      store.bookmarks[qData.id] = true;
      AudioEngine.click();
      showToast('Добавлено в избранное ⭐', 'success');
    }

    saveStore();
    renderActiveQuestion();
    updateMistakesCountBadge();
  }

  function toggleActiveFlag() {
    const test = App.currentTest;
    const idx = test.currentIndex;

    if (test.flags.has(idx)) {
      test.flags.delete(idx);
    } else {
      test.flags.add(idx);
    }

    AudioEngine.click();
    renderActiveQuestion();
    renderQuestionNavigator();
  }

  // =========================================================================
  // 8. FINISH & RESULTS CALCULATIONS
  // =========================================================================
  function showConfirmFinishModal() {
    const test = App.currentTest;
    const totalQ = test.questions.length;
    const answeredCount = Object.keys(test.userAnswers).length;
    const unanswered = totalQ - answeredCount;

    const modal = document.getElementById('modal-confirm-finish');
    const msg = document.getElementById('confirm-finish-msg');

    if (unanswered > 0) {
      msg.textContent = `У вас осталось ${unanswered} неотвеченных вопросов из ${totalQ}. Вы уверены, что хотите завершить экзамен прямо сейчас?`;
    } else {
      msg.textContent = `Вы ответили на все ${totalQ} вопросов! Завершить тестирование и узнать ваш результат?`;
    }

    modal.classList.add('active');
  }

  function finishTest() {
    const test = App.currentTest;
    test.isFinished = true;
    test.endTime = Date.now();

    if (test.timerInterval) clearInterval(test.timerInterval);

    // Close any modal
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));

    // Calculate score
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    test.questions.forEach((q, idx) => {
      const userAns = test.userAnswers[idx];
      if (userAns === undefined) {
        skippedCount++;
      } else if (q.options[userAns].isCorrect) {
        correctCount++;
      } else {
        wrongCount++;
      }
    });

    const total = test.questions.length;
    const pct = Math.round((correctCount / total) * 100);
    const passed = pct >= 70; // 70% passing threshold for judges
    const elapsedSeconds = Math.max(1, Math.round((test.endTime - test.startTime) / 1000));

    // Save Exam to History
    store.examHistory.push({
      date: new Date().toISOString(),
      mode: test.mode,
      total,
      correct: correctCount,
      wrong: wrongCount,
      score: pct,
      passed,
      timeSeconds: elapsedSeconds
    });
    saveStore();

    // Render Results Screen
    renderResultsScreen({
      total,
      correct: correctCount,
      wrong: wrongCount,
      skipped: skippedCount,
      percentage: pct,
      passed,
      elapsedSeconds
    });

    switchView('view-test-results');

    // Celebratory effect if passed
    if (passed) {
      AudioEngine.finishFanfare();
      Confetti.fire(4500);
    } else {
      AudioEngine.wrong();
    }
  }

  function finishMarathon() {
    const test = App.currentTest;
    showToast(`Марафон окончен! Ваш результат: ${test.marathonScore} вопросов`, 'info');
    finishTest();
  }

  function renderResultsScreen(res) {
    const statusBadge = document.getElementById('result-badge-status');
    const statusText = document.getElementById('result-status-text');
    const verdictDesc = document.getElementById('result-verdict-desc');
    const radialCircle = document.getElementById('result-radial-circle');
    const pctText = document.getElementById('result-percentage-text');
    const fracText = document.getElementById('result-fraction-text');

    statusBadge.className = `result-badge-status ${res.passed ? 'passed' : 'failed'}`;
    statusText.textContent = res.passed ? 'ЭКЗАМЕН СДАН' : 'ЭКЗАМЕН НЕ СДАН';

    if (res.passed) {
      verdictDesc.textContent = `Поздравляем! Ваш результат (${res.percentage}%) превышает квалификационный барьер (70%) для кандидатов на должность судьи Кыргызской Республики.`;
    } else {
      verdictDesc.textContent = `К сожалению, порог 70% не преодолен. Рекомендуем провести работу над ошибками и пройти тренировку по сложным темам.`;
    }

    pctText.textContent = `${res.percentage}%`;
    fracText.textContent = `${res.correct} из ${res.total}`;

    // Animated radial stroke
    const circumference = 314.159;
    const offset = circumference - (circumference * res.percentage) / 100;
    radialCircle.className = `radial-progress ${res.passed ? 'passed' : 'failed'}`;
    radialCircle.style.strokeDashoffset = offset;

    // Stat boxes
    document.getElementById('result-stat-correct').textContent = res.correct;
    document.getElementById('result-stat-wrong').textContent = res.wrong + res.skipped;

    const mins = Math.floor(res.elapsedSeconds / 60);
    const secs = res.elapsedSeconds % 60;
    document.getElementById('result-stat-time').textContent = `${mins} мин ${secs} сек`;

    const avgSpeed = Math.round(res.elapsedSeconds / res.total);
    document.getElementById('result-stat-speed').textContent = `${avgSpeed} сек`;

    // Render Detailed Question Review List
    renderResultsReviewList('all');
  }

  function renderResultsReviewList(filter = 'all') {
    const test = App.currentTest;
    const container = document.getElementById('review-cards-list');
    if (!container) return;

    container.innerHTML = '';

    test.questions.forEach((q, idx) => {
      const userAns = test.userAnswers[idx];
      const isAnswered = userAns !== undefined;
      const isCorrect = isAnswered && q.options[userAns].isCorrect;
      const isFlagged = test.flags.has(idx);

      if (filter === 'wrong' && isCorrect) return;
      if (filter === 'flagged' && !isFlagged) return;

      const card = document.createElement('div');
      card.className = `review-q-card ${!isAnswered ? 'is-skipped' : isCorrect ? 'is-correct' : 'is-wrong'}`;

      const sec = App.sectionsMap[q.secId];

      let statusHtml = '';
      if (!isAnswered) {
        statusHtml = '<span style="color: var(--text-muted); font-weight:700;">ПРОПУЩЕН</span>';
      } else if (isCorrect) {
        statusHtml = '<span style="color: var(--color-success); font-weight:700;">✓ ВЕРНО</span>';
      } else {
        statusHtml = '<span style="color: var(--color-danger); font-weight:700;">✕ ОШИБКА</span>';
      }

      let optionsHtml = '';
      q.options.forEach((opt, optIdx) => {
        let style = 'padding: 0.5rem 0.85rem; border-radius: 6px; margin-bottom: 0.35rem; font-size: 0.875rem;';
        if (opt.isCorrect) {
          style += 'background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight:600; border: 1px solid rgba(16, 185, 129, 0.3);';
        } else if (userAns === optIdx) {
          style += 'background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);';
        } else {
          style += 'background: var(--bg-tertiary); color: var(--text-secondary);';
        }

        optionsHtml += `
          <div style="${style}">
            ${opt.isCorrect ? '★ [ПРАВИЛЬНЫЙ ОТВЕТ] ' : ''}
            ${userAns === optIdx && !opt.isCorrect ? '✕ [ВАШ ОТВЕТ] ' : ''}
            ${escapeHtml(opt.text)}
          </div>
        `;
      });

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
          <span style="font-size:0.75rem; color:var(--brand-primary-light); font-weight:700;">
            ${sec ? sec.code + '. ' + sec.name : ''} • Вопрос №${idx + 1}
          </span>
          <div>${statusHtml}</div>
        </div>
        <div style="font-size:1rem; font-weight:600; margin-bottom:1rem; line-height:1.45;">
          ${q.num}. ${escapeHtml(q.question)}
        </div>
        <div>${optionsHtml}</div>
      `;

      container.appendChild(card);
    });
  }

  // =========================================================================
  // 9. TOPICS PRACTICE VIEW
  // =========================================================================
  function renderPracticeTopics() {
    const grid = document.getElementById('topics-grid');
    if (!grid || !App.database) return;

    grid.innerHTML = '';
    const selectedSecs = getSelectedTopicIds();

    App.database.sections.forEach(sec => {
      const card = document.createElement('div');
      card.className = 'topic-select-card';
      card.setAttribute('data-sec-id', sec.id);

      const isChecked = selectedSecs.has(sec.id);
      if (isChecked) card.classList.add('selected');

      // Calculate mastery
      const secQuestions = App.database.questions.filter(q => q.secId === sec.id);
      let solvedCount = 0;
      let correctCount = 0;

      secQuestions.forEach(q => {
        const stat = store.solvedStats[q.id];
        if (stat && stat.solved > 0) {
          solvedCount++;
          if (stat.correct > 0) correctCount++;
        }
      });

      const masteryPct = secQuestions.length > 0 ? Math.round((correctCount / secQuestions.length) * 100) : 0;

      card.innerHTML = `
        <div class="topic-card-top">
          <span class="topic-num-badge">${sec.code}</span>
          <div class="topic-checkbox">
            ${isChecked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
        </div>
        <div class="topic-card-title">${escapeHtml(sec.name)}</div>
        <div class="topic-card-footer">
          <span class="topic-count-pill">${sec.count} вопросов</span>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:0.75rem; color:var(--text-muted);">${masteryPct}%</span>
            <div class="topic-mastery-bar">
              <div class="topic-mastery-fill" style="width: ${masteryPct}%;"></div>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        AudioEngine.click();
        card.classList.toggle('selected');
        const box = card.querySelector('.topic-checkbox');
        if (card.classList.contains('selected')) {
          box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
        } else {
          box.innerHTML = '';
        }
        updatePracticeStartLabel();
      });

      grid.appendChild(card);
    });

    updatePracticeStartLabel();
  }

  function getSelectedTopicIds() {
    const selected = new Set();
    document.querySelectorAll('.topic-select-card.selected').forEach(c => {
      selected.add(Number(c.getAttribute('data-sec-id')));
    });
    return selected;
  }

  function updatePracticeStartLabel() {
    const count = getSelectedTopicIds().size;
    const label = document.getElementById('btn-practice-label');
    if (label) {
      label.textContent = `Начать тренировку (${count} тем)`;
    }
  }

  // =========================================================================
  // 10. SEARCH & QUESTION BANK
  // =========================================================================
  function populateSearchSectionsDropdown() {
    const select = document.getElementById('search-section-filter');
    if (!select || !App.database) return;

    select.innerHTML = '<option value="all">Все отрасли права (21 тема)</option>';
    App.database.sections.forEach(sec => {
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = `${sec.code}. ${sec.name} (${sec.count})`;
      select.appendChild(opt);
    });
  }

  let searchDebounceTimeout = null;
  function handleSearchInput() {
    if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      executeSearch();
    }, 150);
  }

  function executeSearch() {
    if (!App.database) return;

    const queryInput = document.getElementById('search-query-input');
    const secSelect = document.getElementById('search-section-filter');

    const query = (queryInput ? queryInput.value.trim().toLowerCase() : '');
    const secFilter = secSelect ? secSelect.value : 'all';

    App.search.query = query;
    App.search.sectionId = secFilter;
    App.search.displayCount = 30;

    let results = App.database.questions;

    // Filter by section
    if (secFilter !== 'all') {
      const targetSecId = Number(secFilter);
      results = results.filter(q => q.secId === targetSecId);
    }

    // Filter by text query
    if (query) {
      results = results.filter(q => {
        if (q.q.toLowerCase().includes(query)) return true;
        return q.opts.some(opt => opt.toLowerCase().includes(query));
      });
    }

    App.search.filteredQuestions = results;

    const countElem = document.getElementById('search-results-count');
    if (countElem) {
      countElem.textContent = results.length.toLocaleString('ru-RU');
    }

    renderSearchResults();
  }

  function renderSearchResults() {
    const list = document.getElementById('search-results-list');
    const loadMoreWrap = document.getElementById('search-load-more-wrap');
    if (!list) return;

    list.innerHTML = '';
    const slice = App.search.filteredQuestions.slice(0, App.search.displayCount);

    if (slice.length === 0) {
      list.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem; opacity: 0.5;">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <h3>Вопросы не найдены</h3>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">Попробуйте изменить поисковый запрос или выбрать другую тему.</p>
        </div>
      `;
      if (loadMoreWrap) loadMoreWrap.style.display = 'none';
      return;
    }

    slice.forEach(q => {
      const card = document.createElement('div');
      card.className = 'search-item-card';

      const sec = App.sectionsMap[q.secId];
      const isBookmarked = !!store.bookmarks[q.id];

      let optsHtml = '';
      q.opts.forEach((optText, optIdx) => {
        const isCorrect = optIdx === q.ans;
        optsHtml += `
          <div class="search-opt-row ${isCorrect ? 'is-correct' : ''}">
            ${isCorrect ? '<strong>✓</strong>' : '•'}
            <span>${escapeHtml(optText)}</span>
          </div>
        `;
      });

      card.innerHTML = `
        <div class="search-item-header">
          <span class="search-q-num">
            ${sec ? sec.code + '. ' + sec.name : ''} • Вопрос №${q.num}
          </span>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-ghost btn-sm btn-copy-q" title="Скопировать вопрос">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="action-icon-toggle ${isBookmarked ? 'flagged' : ''} btn-search-bookmark" title="В избранное">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          </div>
        </div>
        <div class="search-q-title">
          ${q.num}. ${escapeHtml(q.q)}
        </div>
        <div class="search-opts-list">
          ${optsHtml}
        </div>
      `;

      // Copy Button
      card.querySelector('.btn-copy-q').addEventListener('click', () => {
        const textToCopy = `${q.q}\nПравильный ответ: ${q.opts[q.ans]}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast('Вопрос скопирован в буфер обмена', 'success');
        });
      });

      // Bookmark Button
      card.querySelector('.btn-search-bookmark').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (store.bookmarks[q.id]) {
          delete store.bookmarks[q.id];
          btn.classList.remove('flagged');
          showToast('Удалено из избранного', 'info');
        } else {
          store.bookmarks[q.id] = true;
          btn.classList.add('flagged');
          AudioEngine.click();
          showToast('Добавлено в избранное ⭐', 'success');
        }
        saveStore();
        updateMistakesCountBadge();
      });

      list.appendChild(card);
    });

    if (loadMoreWrap) {
      loadMoreWrap.style.display = App.search.displayCount < App.search.filteredQuestions.length ? 'block' : 'none';
    }
  }

  // =========================================================================
  // 11. STATISTICS & ERROR BANK DASHBOARD
  // =========================================================================
  function recordQuestionAttempt(qId, isCorrect) {
    if (!store.solvedStats[qId]) {
      store.solvedStats[qId] = { solved: 0, correct: 0 };
    }
    store.solvedStats[qId].solved++;
    if (isCorrect) {
      store.solvedStats[qId].correct++;
      // If was previously in mistake bank, we can graduate it or reduce count
      if (store.mistakes[qId]) {
        delete store.mistakes[qId];
      }
    } else {
      if (!store.mistakes[qId]) {
        store.mistakes[qId] = { wrongCount: 0, lastWrongAt: Date.now() };
      }
      store.mistakes[qId].wrongCount++;
      store.mistakes[qId].lastWrongAt = Date.now();
    }
    saveStore();
    updateMistakesCountBadge();
  }

  function updateMistakesCountBadge() {
    const errCount = Object.keys(store.mistakes).length;
    const badge = document.getElementById('errors-count-badge');
    const counterBtn = document.getElementById('btn-mistakes-counter');
    const bookCount = Object.keys(store.bookmarks).length;
    const bookCounter = document.getElementById('btn-bookmarks-counter');

    if (badge) {
      badge.textContent = errCount;
      badge.style.display = errCount > 0 ? 'inline-block' : 'none';
    }
    if (counterBtn) counterBtn.textContent = errCount;
    if (bookCounter) bookCounter.textContent = bookCount;
  }

  function renderStatsDashboard() {
    if (!App.database) return;

    let totalSolved = 0;
    let totalCorrect = 0;

    Object.values(store.solvedStats).forEach(s => {
      totalSolved += s.solved;
      totalCorrect += s.correct;
    });

    const accuracyPct = totalSolved > 0 ? Math.round((totalCorrect / totalSolved) * 100) : 0;
    const errBankCount = Object.keys(store.mistakes).length;
    const bookmarksCount = Object.keys(store.bookmarks).length;

    document.getElementById('stat-total-solved').textContent = totalSolved.toLocaleString('ru-RU');
    document.getElementById('stat-accuracy-pct').textContent = `${accuracyPct}%`;
    document.getElementById('stat-bank-errors-count').textContent = errBankCount.toLocaleString('ru-RU');
    document.getElementById('stat-bookmarks-count').textContent = bookmarksCount.toLocaleString('ru-RU');

    // Overall Progress % in Sidebar
    const overallCorrectQ = Object.values(store.solvedStats).filter(s => s.correct > 0).length;
    const overallMasteryPct = Math.round((overallCorrectQ / App.database.total) * 100);
    const sidebarPct = document.getElementById('sidebar-mastery-pct');
    if (sidebarPct) sidebarPct.textContent = `${overallMasteryPct}%`;

    // Render 21 Sections Mastery Progress Bars
    const topicRowsList = document.getElementById('stats-topic-rows-list');
    if (topicRowsList) {
      topicRowsList.innerHTML = '';

      App.database.sections.forEach(sec => {
        const secQuestions = App.database.questions.filter(q => q.secId === sec.id);
        const correctInSec = secQuestions.filter(q => {
          const st = store.solvedStats[q.id];
          return st && st.correct > 0;
        }).length;

        const secPct = secQuestions.length > 0 ? Math.round((correctInSec / secQuestions.length) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'topic-stat-row';

        let barColor = 'var(--brand-primary-light)';
        if (secPct >= 70) barColor = 'var(--color-success)';
        else if (secPct > 0 && secPct < 50) barColor = 'var(--color-warning)';

        row.innerHTML = `
          <div class="topic-stat-name">${sec.code}. ${escapeHtml(sec.name)}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); width: 85px; text-align: right;">
            ${correctInSec}/${sec.count}
          </div>
          <div class="topic-stat-bar-wrap">
            <div class="topic-stat-bar-fill" style="width: ${secPct}%; background: ${barColor};"></div>
          </div>
          <div class="topic-stat-pct">${secPct}%</div>
        `;

        topicRowsList.appendChild(row);
      });
    }
  }

  // =========================================================================
  // 11.5 MOBILE & SAFARI HELPERS
  // =========================================================================
  function openMobilePalette() {
    const sidebar = document.getElementById('question-nav-sidebar');
    const backdrop = document.getElementById('mobile-palette-backdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
  }

  function closeMobilePalette() {
    const sidebar = document.getElementById('question-nav-sidebar');
    const backdrop = document.getElementById('mobile-palette-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }

  function toggleMobilePalette() {
    const sidebar = document.getElementById('question-nav-sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      closeMobilePalette();
    } else {
      openMobilePalette();
    }
  }

  function setupTouchSwipeNavigation() {
    const runner = document.getElementById('view-test-runner');
    if (!runner) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    runner.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const sidebar = document.getElementById('question-nav-sidebar');
      if (sidebar && sidebar.classList.contains('open')) return;

      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    runner.addEventListener('touchend', (e) => {
      if (!touchStartX || !touchStartY) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;

      touchStartX = 0;
      touchStartY = 0;

      // Horizontal swipe threshold: min 60px horizontal, max 55px vertical, within 500ms
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 55 && deltaTime < 500) {
        if (deltaX < 0) {
          nextQuestion();
        } else {
          prevQuestion();
        }
      }
    }, { passive: true });
  }

  // =========================================================================
  // 12. EVENT LISTENERS SETUP
  // =========================================================================
  function setupEventListeners() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        AudioEngine.click();
        const view = e.currentTarget.getAttribute('data-view');
        switchView(view);
      });
    });

    document.getElementById('logo-link').addEventListener('click', (e) => {
      e.preventDefault();
      switchView('view-exam-setup');
    });

    // Theme Toggle
    document.getElementById('btn-toggle-theme').addEventListener('click', () => {
      AudioEngine.click();
      const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      store.settings.theme = newTheme;
      saveStore();
    });

    // Sound Toggle
    document.getElementById('btn-toggle-sound').addEventListener('click', () => {
      store.settings.sound = !store.settings.sound;
      applySoundState(store.settings.sound);
      if (store.settings.sound) AudioEngine.click();
      saveStore();
    });

    // Safari & Cross-Browser Fullscreen Toggle
    document.getElementById('btn-toggle-fullscreen').addEventListener('click', () => {
      AudioEngine.click();
      const doc = document.documentElement;
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

      if (!isFullscreen) {
        if (doc.requestFullscreen) {
          doc.requestFullscreen().catch(() => {});
        } else if (doc.webkitRequestFullscreen) {
          doc.webkitRequestFullscreen();
        } else {
          showToast('Полноэкранный режим не поддерживается на данном мобильном браузере');
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    });

    // Mobile Question Palette Triggers
    const btnTogglePalette = document.getElementById('btn-toggle-mobile-palette');
    if (btnTogglePalette) {
      btnTogglePalette.addEventListener('click', () => {
        AudioEngine.click();
        toggleMobilePalette();
      });
    }

    const btnClosePalette = document.getElementById('btn-close-mobile-palette');
    if (btnClosePalette) {
      btnClosePalette.addEventListener('click', () => {
        AudioEngine.click();
        closeMobilePalette();
      });
    }

    const paletteBackdrop = document.getElementById('mobile-palette-backdrop');
    if (paletteBackdrop) {
      paletteBackdrop.addEventListener('click', () => {
        closeMobilePalette();
      });
    }

    // Touch swipe navigation for mobile
    setupTouchSwipeNavigation();

    // Unlock Web Audio for Safari / iOS on first user interaction
    const unlockAudioSafari = () => {
      AudioEngine.init();
      window.removeEventListener('touchstart', unlockAudioSafari, true);
      window.removeEventListener('touchend', unlockAudioSafari, true);
      window.removeEventListener('click', unlockAudioSafari, true);
    };
    window.addEventListener('touchstart', unlockAudioSafari, { capture: true, passive: true });
    window.addEventListener('touchend', unlockAudioSafari, { capture: true, passive: true });
    window.addEventListener('click', unlockAudioSafari, { capture: true });

    // Shortcuts Modal
    document.getElementById('btn-show-shortcuts').addEventListener('click', () => {
      AudioEngine.click();
      document.getElementById('modal-shortcuts').classList.add('active');
    });
    document.getElementById('btn-close-modal-shortcuts').addEventListener('click', () => {
      document.getElementById('modal-shortcuts').classList.remove('active');
    });
    document.getElementById('btn-shortcuts-ok').addEventListener('click', () => {
      document.getElementById('modal-shortcuts').classList.remove('active');
    });

    // Exam Setup Choice Pills
    setupPillsGroup('exam-q-count-pills');
    setupPillsGroup('exam-timer-pills');
    setupPillsGroup('exam-mode-pills');

    // Start Exam Button
    document.getElementById('btn-start-exam').addEventListener('click', () => {
      const qCount = Number(getSelectedPillVal('exam-q-count-pills', 100));
      const timeLimit = Number(getSelectedPillVal('exam-timer-pills', 90));
      const selectionMode = getSelectedPillVal('exam-mode-pills', 'balanced');
      const instantFeedback = document.getElementById('exam-instant-feedback').checked;
      const shuffleOptions = document.getElementById('exam-shuffle-options').checked;

      startTest({
        mode: 'exam',
        qCount,
        timeLimitMinutes: timeLimit,
        selectionMode,
        instantFeedback,
        shuffleOptions
      });
    });

    // Active Test Controls
    document.getElementById('btn-next-q').addEventListener('click', () => nextQuestion());
    document.getElementById('btn-prev-q').addEventListener('click', () => prevQuestion());
    document.getElementById('btn-toggle-bookmark').addEventListener('click', () => toggleActiveBookmark());
    document.getElementById('btn-toggle-flag').addEventListener('click', () => toggleActiveFlag());
    document.getElementById('btn-finish-test-early').addEventListener('click', () => showConfirmFinishModal());

    // Font Zoom Controls
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      store.settings.fontSizeQ = Math.min(1.5, store.settings.fontSizeQ + 0.1);
      applyFontSize(store.settings.fontSizeQ);
      saveStore();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      store.settings.fontSizeQ = Math.max(0.9, store.settings.fontSizeQ - 0.1);
      applyFontSize(store.settings.fontSizeQ);
      saveStore();
    });

    // Confirm Finish Modal buttons
    document.getElementById('btn-cancel-finish').addEventListener('click', () => {
      document.getElementById('modal-confirm-finish').classList.remove('active');
    });
    document.getElementById('btn-confirm-finish').addEventListener('click', () => {
      finishTest();
    });

    // Results Actions
    document.getElementById('btn-retry-mistakes').addEventListener('click', () => {
      startTest({
        mode: 'mistakes',
        qCount: 0,
        timeLimitMinutes: 0,
        instantFeedback: true,
        shuffleOptions: true
      });
    });

    document.getElementById('btn-restart-exam').addEventListener('click', () => {
      switchView('view-exam-setup');
    });

    document.getElementById('btn-toggle-review-list').addEventListener('click', () => {
      const sec = document.getElementById('results-breakdown-sec');
      sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
      if (sec.style.display === 'block') {
        sec.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Results Review Filters
    document.querySelectorAll('[data-review-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-review-filter]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        renderResultsReviewList(e.currentTarget.getAttribute('data-review-filter'));
      });
    });

    // Practice View Actions
    document.getElementById('btn-select-all-topics').addEventListener('click', () => {
      AudioEngine.click();
      document.querySelectorAll('.topic-select-card').forEach(c => {
        c.classList.add('selected');
        c.querySelector('.topic-checkbox').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      });
      updatePracticeStartLabel();
    });

    document.getElementById('btn-deselect-all-topics').addEventListener('click', () => {
      AudioEngine.click();
      document.querySelectorAll('.topic-select-card').forEach(c => {
        c.classList.remove('selected');
        c.querySelector('.topic-checkbox').innerHTML = '';
      });
      updatePracticeStartLabel();
    });

    document.getElementById('btn-start-practice-selected').addEventListener('click', () => {
      const selectedSecs = Array.from(getSelectedTopicIds());
      if (selectedSecs.length === 0) {
        showToast('Пожалуйста, выберите хотя бы одну тему!', 'danger');
        return;
      }

      startTest({
        mode: 'practice',
        sectionIds: selectedSecs,
        timeLimitMinutes: 0,
        instantFeedback: true,
        shuffleOptions: true
      });
    });

    // Marathon View Actions
    document.getElementById('btn-start-marathon').addEventListener('click', () => {
      startTest({
        mode: 'marathon',
        timeLimitMinutes: 0,
        instantFeedback: true,
        shuffleOptions: true
      });
    });

    // Search View Actions
    document.getElementById('search-query-input').addEventListener('input', handleSearchInput);
    document.getElementById('search-section-filter').addEventListener('change', executeSearch);
    document.getElementById('btn-search-load-more').addEventListener('click', () => {
      App.search.displayCount += 30;
      renderSearchResults();
    });

    // Stats View Quick Practice Actions
    document.getElementById('btn-practice-all-mistakes').addEventListener('click', () => {
      startTest({
        mode: 'mistakes',
        timeLimitMinutes: 0,
        instantFeedback: true,
        shuffleOptions: true
      });
    });

    document.getElementById('btn-practice-all-bookmarks').addEventListener('click', () => {
      startTest({
        mode: 'bookmarks',
        timeLimitMinutes: 0,
        instantFeedback: true,
        shuffleOptions: true
      });
    });

    document.getElementById('btn-reset-all-data').addEventListener('click', () => {
      if (confirm('Вы уверены, что хотите сбросить всю сохраненную статистику, банк ошибок и историю тестов?')) {
        localStorage.removeItem(STORAGE_KEY);
        store = Object.assign({}, defaultStorage);
        updateMistakesCountBadge();
        renderStatsDashboard();
        showToast('Статистика успешно сброшена', 'info');
      }
    });

    // Keyboard Shortcuts Listener
    window.addEventListener('keydown', handleGlobalKeydown);
  }

  function handleGlobalKeydown(e) {
    // If typing in input or select, skip
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      return;
    }

    if (App.activeViewId === 'view-test-runner') {
      // 1, 2, 3, 4 for options
      if (['1', '2', '3', '4'].includes(e.key)) {
        const optIdx = parseInt(e.key, 10) - 1;
        const test = App.currentTest;
        const qData = test.questions[test.currentIndex];
        if (qData && optIdx < qData.options.length) {
          selectOption(optIdx);
        }
      }

      // Enter or ArrowRight for next
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        nextQuestion();
      }

      // ArrowLeft for prev
      if (e.key === 'ArrowLeft') {
        prevQuestion();
      }

      // 'f' or 'F' for flag
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        toggleActiveFlag();
      }

      // 'b' or 'B' for bookmark
      if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        toggleActiveBookmark();
      }
    }
  }

  // =========================================================================
  // 13. UI UTILITIES & HELPERS
  // =========================================================================
  function setupPillsGroup(groupId) {
    const container = document.getElementById(groupId);
    if (!container) return;

    container.querySelectorAll('.pill-option').forEach(pill => {
      pill.addEventListener('click', (e) => {
        AudioEngine.click();
        container.querySelectorAll('.pill-option').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });
  }

  function getSelectedPillVal(groupId, defaultVal) {
    const container = document.getElementById(groupId);
    if (!container) return defaultVal;
    const active = container.querySelector('.pill-option.active');
    return active ? active.getAttribute('data-val') : defaultVal;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function applySoundState(soundEnabled) {
    const btn = document.getElementById('btn-toggle-sound');
    if (btn) btn.classList.toggle('active', soundEnabled);
  }

  function applyFontSize(sizeRem) {
    document.documentElement.style.setProperty('--font-size-q', `${sizeRem}rem`);
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // RUN APPLICATION
  // =========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApplication);
  } else {
    initApplication();
  }

})();
