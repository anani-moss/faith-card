/**
 * Easter Card Composer — Canvas Composition Engine
 * Mobile-first with touch + mouse support.
 * Fixed image export: pre-caches images as data URLs.
 */



(function () {
  "use strict";

  // ─── Image Library (populated dynamically) ─────────────
  const IMAGE_LIBRARY = {
    main: [],
    temp: [],
    elements: [],
    decor: [],
  };

  const supabase = window.supabase.createClient(
    "https://sdaerjimvxudykyatvgc.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYWVyamltdnh1ZHlreWF0dmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MzE5OTEsImV4cCI6MjA5MDQwNzk5MX0.O3nfO7Q3OaBbuv5NOAD1n-o9-d_taW56AzWBvhQSCow"
  );

  async function incrementSaveCount() {
    const { error } = await supabase.rpc('increment_saves');

    if (error) {
      console.error("Failed to increment save count:", error);
    }
  }

  document.getElementById("btn-download").addEventListener("click", () => {
    incrementSaveCount();
    setTimeout(() => {
      getSaveCount();
    }, 3000);
  });

  async function getSaveCount() {
    const { data, error } = await supabase
      .from('global_stats')
      .select('saves')
      .eq('id', 1)
      .single();

    if (!error) {
      console.log("Total saves:", data.saves);
    }
  }


  // ─── Haptic Feedback ───────────────────────────────────
  function haptic(intensity) {
    // intensity: 'light' | 'medium' | 'heavy' | 'success' | 'error'
    if (!navigator.vibrate) return;
    switch (intensity) {
      case 'light': navigator.vibrate(8); break;
      case 'medium': navigator.vibrate(15); break;
      case 'heavy': navigator.vibrate([10, 30, 20]); break;
      case 'success': navigator.vibrate([15, 30, 15]); break; // Double-tap feel
      case 'error': navigator.vibrate([25, 30, 25, 30, 25]); break; // Sharp triple-pulse
      default: navigator.vibrate(10);
    }
  }

  // ─── State ─────────────────────────────────────────────
  const CANVAS_SIZE = 1080;
  let elements = [];
  let nextId = 1;
  let selectedId = null;
  let dragging = null;
  let resizing = null;
  let snapEnabled = true;
  let gridEnabled = false;
  let simpleMode = true;

  // Pre-cached images as data URLs for reliable export
  const imageCache = new Map();

  // ─── DOM Refs (deferred to DOMContentLoaded) ───────────
  let canvasEl, placeholder, propertiesPanel, propsImage, propsText;
  let downloadModal, downloadNameInput;

  // ─── Background Configuration ────────────────────────────
  let bgConfig = {
    type: "solid", // "solid" | "gradient"
    solidColor: "#ffffff",
    gradColor1: "#FFB6C1",
    gradColor2: "#87CEFA",
    gradAngle: 135
  };

  // ─── CDN Configuration ──────────────────────────────────
  let CDN_BASE = "https://cdn.jsdelivr.net/gh/thenewlegend/faithcard-cdn@main";
  let manifest = null; // Default to null to know if it failed

  async function loadManifest() {
    try {
      // 1. Fetch latest commit SHA with a cache-buster (?t=)
      // This instantly bypasses jsDelivr's 12-hour cache limit for new updates,
      // while preserving permanent CDN edge caching for the specific commit.
      const commitRes = await fetch(`https://api.github.com/repos/thenewlegend/faithcard-cdn/commits/main?t=${Date.now()}`);

      // Log Rate Limits to the console
      const remaining = commitRes.headers.get("x-ratelimit-remaining");
      if (remaining !== null) {
        console.log(`GitHub API Rate Limit Remaining: ${remaining}`);
      }

      if (commitRes.ok) {
        const commitData = await commitRes.json();
        const sha = commitData.sha;
        console.log(`⚡ CDN Version Detected (SHA): ${sha}`);
        CDN_BASE = `https://cdn.jsdelivr.net/gh/thenewlegend/faithcard-cdn@${sha}`;
      } else {
        console.warn(`⚠️ GitHub API call failed (Status: ${commitRes.status}). Falling back to @main cache.`);
      }

      // 2. Load the manifest.json using the fresh URL
      // Also add a cache-buster to the manifest itself to ensure we see new files immediately
      const res = await fetch(`${CDN_BASE}/manifest.json?t=${Date.now()}`);
      if (res.ok) {
        manifest = await res.json();
        console.log("✅ CDN Manifest loaded successfully:", manifest);
      } else {
        console.warn(`⚠️ Could not load manifest.json from CDN (Status: ${res.status}), falling back to probing.`);
      }
    } catch (e) {
      console.error("❌ Manifest/CDN loading error:", e);
    }
  }

  // ─── Init ──────────────────────────────────────────────
  function init() {
    canvasEl = document.getElementById("canvas");
    placeholder = document.getElementById("canvas-placeholder");
    propertiesPanel = document.getElementById("properties-panel");
    propsImage = document.getElementById("props-image");
    propsText = document.getElementById("props-text");
    downloadModal = document.getElementById("download-modal");
    downloadNameInput = document.getElementById("download-name-input");

    // UI Bindings (Synchronous - prevents layout bouncing/shifting)
    bindTabs();
    bindHeaderButtons();
    bindPropertiesPanel();
    bindCanvasEvents();
    bindKeyboard();
    bindModal();
    bindBgColorModal();
    bindOverlayControl();
    fitCanvasToScreen();
    bindPanelGestures();
    checkFirstLoadOverlay();
    window.addEventListener("resize", fitCanvasToScreen);
    bindHamburger();
    initSplash();
    bindModeToggle();

    // Data Fetching (Asynchronous background task)
    loadData();
  }

  async function loadData() {
    showSkeletons();
    await loadManifest();
    await Promise.all([discoverImages(), discoverOverlays()]);
    removeSkeletons();
    checkEmptyState();
  }

  function showSkeletons() {
    Object.keys(IMAGE_LIBRARY).forEach(category => {
      const grid = document.getElementById(`grid-${category}`);
      if (!grid) return;
      // Add 6 skeleton loaders per category
      for (let i = 0; i < 6; i++) {
        const skel = document.createElement("div");
        skel.className = "skeleton-thumb loading-skeleton";
        grid.appendChild(skel);
      }
    });
  }

  function removeSkeletons() {
    document.querySelectorAll(".loading-skeleton").forEach(el => el.remove());
  }

  function checkEmptyState() {
    const hasAnyImages = Object.values(IMAGE_LIBRARY).some(arr => arr.length > 0);
    if (!hasAnyImages) {
      // Show retry button
      const gridMain = document.getElementById("grid-main");
      if (gridMain && !document.getElementById("btn-retry-fetch")) {
        const retryContainer = document.createElement("div");
        retryContainer.className = "retry-container";
        retryContainer.innerHTML = `
          <p>Failed to load image library.</p>
          <button id="btn-retry-fetch" class="btn m3-btn-tonal">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-12.28l5.57 5.57"/>
             </svg>
             Retry
          </button>
        `;
        retryContainer.querySelector("button").addEventListener("click", () => {
          retryContainer.remove();
          loadData();
        });
        gridMain.appendChild(retryContainer);
      }
    }
  }

  // ─── Hamburger Menu ────────────────────────────────────
  function bindHamburger() {
    const btn = document.getElementById("btn-hamburger");
    const menu = document.getElementById("header-actions");
    if (!btn || !menu) return;

    btn.addEventListener("click", () => {
      haptic('light');
      const isOpen = menu.classList.toggle("open");
      btn.classList.toggle("open", isOpen);
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!menu.classList.contains("open")) return;
      if (!e.target.closest("#app-header")) {
        menu.classList.remove("open");
        btn.classList.remove("open");
      }
    });

    // Close menu after any button inside is clicked
    menu.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        // Small delay so the action fires first
        setTimeout(() => {
          menu.classList.remove("open");
          btn.classList.remove("open");
        }, 150);
      });
    });
  }

  // ─── Splash Tutorial ────────────────────────────────────
  function initSplash() {
    const STORAGE_KEY = "faithcard_splash_hidden_until";
    const overlay = document.getElementById("splash-overlay");
    if (!overlay) return;

    const slidesContainer = document.getElementById("splash-slides");
    const slides = slidesContainer.querySelectorAll(".splash-slide");
    const dotsContainer = document.getElementById("splash-dots");
    const prevBtn = document.getElementById("splash-prev");
    const nextBtn = document.getElementById("splash-next");
    const dontShowCheckbox = document.getElementById("splash-dont-show");
    const totalSlides = slides.length;
    let current = 0;
    let autoPlayInterval = null;
    let dotsBuilt = false;
    let dots;

    function buildDots() {
      if (dotsBuilt) return;
      dotsBuilt = true;
      for (let i = 0; i < totalSlides; i++) {
        const dot = document.createElement("span");
        dot.className = "splash-dot" + (i === 0 ? " active" : "");
        dot.addEventListener("click", () => {
          resetAutoPlay();
          goToSlide(i);
        });
        dotsContainer.appendChild(dot);
      }
      dots = dotsContainer.querySelectorAll(".splash-dot");
    }

    function goToSlide(idx) {
      current = idx;
      slidesContainer.style.transform = `translateX(-${current * 100}%)`;
      haptic('light');

      if (dots) dots.forEach((d, i) => d.classList.toggle("active", i === current));
      prevBtn.disabled = current === 0;

      if (current === totalSlides - 1) {
        nextBtn.textContent = "Get Started";
      } else {
        nextBtn.textContent = "Next";
      }
    }

    function startAutoPlay() {
      stopAutoPlay();
      autoPlayInterval = setInterval(() => {
        if (current < totalSlides - 1) {
          goToSlide(current + 1);
        } else {
          stopAutoPlay();
        }
      }, 60000);
    }

    function stopAutoPlay() {
      if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
      }
    }

    function resetAutoPlay() {
      stopAutoPlay();
      if (current < totalSlides - 1) startAutoPlay();
    }

    function showSplash() {
      buildDots();
      dontShowCheckbox.checked = false;
      goToSlide(0);
      overlay.classList.remove("closing");
      overlay.style.display = "flex";
      // Re-trigger entrance animation
      overlay.style.animation = "none";
      overlay.offsetHeight; // reflow
      overlay.style.animation = "";
      startAutoPlay();
    }

    function closeSplash(onComplete) {
      stopAutoPlay();
      haptic('medium');

      if (dontShowCheckbox.checked) {
        const threeHours = 3 * 60 * 60 * 1000;
        localStorage.setItem(STORAGE_KEY, String(Date.now() + threeHours));
      }

      overlay.classList.add("closing");
      overlay.addEventListener("animationend", () => {
        overlay.style.display = "none";
        overlay.classList.remove("closing");

        if (typeof onComplete === "function") {
          requestAnimationFrame(() => onComplete());
        }
      }, { once: true });
    }

    // --- Checkbox Reset Logic ---
    function resetCheckbox() {
      const checkbox = document.getElementById('jy-overlay-toggle');
      if (!checkbox) return;
      checkbox.checked = false;
      checkbox.offsetHeight;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // --- Next Button ---
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetAutoPlay();

      // Check for progressive scrolling in Slide 1 or any scrollable slide
      const scrollArea = slides[current].querySelector(".splash-scroll-area");
      if (scrollArea) {
        // Tolerance for floating point or sub-pixel differences
        const isAtBottom = Math.abs(scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop) < 10;
        if (!isAtBottom) {
          // Scroll instead of advancing
          scrollArea.scrollBy({ top: scrollArea.clientHeight * 0.75, behavior: "smooth" });
          haptic('light');
          return;
        }
      }

      if (current < totalSlides - 1) {
        goToSlide(current + 1);
      } else {
        closeSplash(() => resetCheckbox());
      }
    });

    prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetAutoPlay();
      if (current > 0) goToSlide(current - 1);
    });

    // Swipe support (desktop + mobile)
    let pointerStartX = 0;
    let isPointerDown = false;
    overlay.style.touchAction = "pan-y";

    overlay.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".splash-dot") || e.target.closest(".splash-scroll-area")) return;
      isPointerDown = true;
      pointerStartX = e.clientX;
      resetAutoPlay();
    }, { passive: true });

    overlay.addEventListener("pointerup", (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      const dx = e.clientX - pointerStartX;
      if (Math.abs(dx) > 50) {
        if (dx < 0 && current < totalSlides - 1) goToSlide(current + 1);
        else if (dx > 0 && current > 0) goToSlide(current - 1);
      }
    });

    overlay.addEventListener("pointercancel", () => {
      isPointerDown = false;
    });

    // Click outside card to dismiss
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSplash();
    });

    // --- Help button to re-show ---
    const helpBtn = document.getElementById("btn-help");
    if (helpBtn) {
      helpBtn.addEventListener("click", () => {
        haptic('light');
        showSplash();
      });
    }

    // --- Initial show/hide ---
    const hiddenUntil = localStorage.getItem(STORAGE_KEY);
    if (hiddenUntil && Date.now() < parseInt(hiddenUntil, 10)) {
      overlay.style.display = "none";
    } else {
      showSplash();
    }
  }

  // --- Confirmation before leaving ---
  window.onbeforeunload = function (e) {
    if (elements && elements.length > 0) {
      e = e || window.event;
      // For modern browsers
      if (e) e.returnValue = "Sure?";
      // For older browsers/some implementations
      return "Sure?";
    }
  };

  function checkFirstLoadOverlay() {
    const toggle = document.getElementById("jy-overlay-toggle");
    if (!toggle) return;

    let choice = null;
    try {
      choice = localStorage.getItem("faithCardOverlayChoice");
    } catch (e) { }

    if (choice === "disabled") {
      toggle.checked = false;
    } else {
      toggle.checked = true;
    }
  }

  function bindPanelGestures() {
    const expandBtn = document.getElementById("btn-expand-panel");
    const panelContent = document.getElementById("panel-content");
    const downloadBtn = document.getElementById("btn-download");

    if (expandBtn && panelContent) {
      expandBtn.addEventListener("click", () => {
        const isExpanded = panelContent.classList.toggle("expanded");

        // Bind button state to panel state
        expandBtn.classList.toggle("open", isExpanded);
      });
    }

    // Swipe down to close properties panel
    let swipeStartY = 0;
    const propPanel = document.getElementById("properties-panel");
    if (!propPanel) return;
    const header = propPanel.querySelector(".panel-header");
    const handle = propPanel.querySelector(".panel-drag-handle");

    const handleTouchStart = (e) => {
      swipeStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
      const swipeEndY = e.changedTouches[0].clientY;
      // Swiped down sufficiently while not scrolling inner contents?
      // To be safe, any swipe down on header/handle closes it.
      if (swipeEndY - swipeStartY > 40) {
        propPanel.classList.add("hidden");
        const settingsBtn = document.getElementById("btn-element-settings");
        if (settingsBtn) {
          settingsBtn
            .querySelector(".icon-settings")
            .classList.remove("hidden");
          settingsBtn.querySelector(".icon-close").classList.add("hidden");
        }
      }
    };

    if (header) {
      header.addEventListener("touchstart", handleTouchStart, {
        passive: true,
      });
      header.addEventListener("touchend", handleTouchEnd);
    }
    if (handle) {
      handle.addEventListener("touchstart", handleTouchStart, {
        passive: true,
      });
      handle.addEventListener("touchend", handleTouchEnd);
    }
  }

  // ─── Discover images in each category folder ───────────
  async function discoverImages() {
    const categories = Object.keys(IMAGE_LIBRARY);

    await Promise.all(
      categories.map(async (category) => {
        // Clear previous state array
        IMAGE_LIBRARY[category] = [];
        const grid = document.getElementById(`grid-${category}`);

        // Clear existing items in grid but skip custom BG button and skeletons
        const elementsToRemove = Array.from(grid.children).filter(child => {
          return !child.classList.contains('btn-custom-bg') && !child.classList.contains('loading-skeleton') && child.id !== 'btn-retry-fetch';
        });
        elementsToRemove.forEach(el => el.remove());

        if (manifest && manifest[category] !== undefined) {
          // Use manifest counts if available
          const count = manifest[category];
          for (let i = 1; i <= count; i++) {
            const fileName = (category === 'temp') ? `template${i}.png` : `${category}${i}.png`;
            const src = `${CDN_BASE}/img/${category}/${fileName}`;
            const entry = { src, label: `${category} ${i}` };
            IMAGE_LIBRARY[category].push(entry);
            buildThumb(grid, src, entry.label, category);
          }
        } else {
          // Fallback: Probe using HEAD requests to CDN
          let i = 1;
          while (true) {
            const fileName = (category === 'temp') ? `template${i}.png` : `${category}${i}.png`;
            const src = `${CDN_BASE}/img/${category}/${fileName}`;
            try {
              const res = await fetch(src, { method: "HEAD" });
              if (!res.ok) break;

              const entry = { src, label: `${category} ${i}` };
              IMAGE_LIBRARY[category].push(entry);
              buildThumb(grid, src, entry.label, category);

              i++;
            } catch (e) {
              break;
            }
          }
        }
      })
    );
  }

  function buildThumb(grid, src, label, category) {
    const thumb = document.createElement("div");
    thumb.className = "image-thumb";
    thumb.title = label;
    thumb.innerHTML = `<img src="${src}" alt="${label}" draggable="false" loading="lazy">`;
    thumb.addEventListener("click", (e) => {
      e.preventDefault();
      const img = thumb.querySelector("img");
      const nw = img && img.naturalWidth > 0 ? img.naturalWidth : 0;
      const nh = img && img.naturalHeight > 0 ? img.naturalHeight : 0;
      addImageToCanvas(src, category, nw, nh);
    });
    grid.appendChild(thumb);
  }

  async function discoverOverlays() {
    const select = document.getElementById("jy-overlay-select");
    if (!select) return;
    // Clear default
    select.innerHTML = "";

    let foundAny = false;

    if (manifest && manifest["jy-overlay"] !== undefined) {
      const count = manifest["jy-overlay"];
      for (let i = 1; i <= count; i++) {
        const src = `${CDN_BASE}/img/jy-overlay/JY-${i}.png`;
        addOverlayOption(select, src, i);
        foundAny = true;
      }
    } else {
      // Fallback probing
      let i = 1;
      while (true) {
        const src = `${CDN_BASE}/img/jy-overlay/JY-${i}.png`;
        try {
          const res = await fetch(src, { method: "HEAD" });
          if (!res.ok) break;

          addOverlayOption(select, src, i);
          foundAny = true;
          i++;
        } catch (e) {
          break;
        }
      }
    }

    if (!foundAny) {
      const opt = document.createElement("option");
      opt.textContent = "None found";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }

    // Auto-update overlay if it was checked before discovery completes
    const toggle = document.getElementById("jy-overlay-toggle");
    const imgOverlay = document.getElementById("jy-overlay-img");
    if (toggle && toggle.checked && imgOverlay) {
      imgOverlay.src = select.value;
    }
  }

  function addOverlayOption(select, src, i) {
    const opt = document.createElement("option");
    opt.value = src;
    opt.textContent = `JY-${i}`;
    select.appendChild(opt);
    cacheImage(src);
  }

  function bindOverlayControl() {
    const toggle = document.getElementById("jy-overlay-toggle");
    const select = document.getElementById("jy-overlay-select");
    const imgOverlay = document.getElementById("jy-overlay-img");

    function updateSwitchLabel() {
      const toggle = document.getElementById("jy-overlay-toggle");
      const text = document.querySelector(".switch-text");

      if (!toggle || !text) return;

      text.textContent = toggle.checked ? "ON" : "OFF";
    }

    // Initial state
    updateSwitchLabel();

    // On change
    document
      .getElementById("jy-overlay-toggle")
      .addEventListener("change", updateSwitchLabel);

    if (!toggle || !select || !imgOverlay) return;

    toggle.addEventListener("change", (e) => {
      select.disabled = !e.target.checked;
      if (e.target.checked) {
        if (select.value) imgOverlay.src = select.value;
        imgOverlay.classList.remove("hidden");
      } else {
        imgOverlay.classList.add("hidden");
      }
      localStorage.setItem(
        "faithCardOverlayChoice",
        e.target.checked ? "enabled" : "disabled",
      );
    });

    select.addEventListener("change", (e) => {
      if (toggle.checked) {
        imgOverlay.src = e.target.value;
      }
    });

    // Preset the image src directly if checked by default (persisted state)
    if (toggle.checked) imgOverlay.src = select.value;
  }

  function cacheImage(src) {
    if (imageCache.has(src)) return;

    // Use fetch to get image as blob — bypasses all CORS/taint issues
    fetch(src)
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          imageCache.set(src, {
            blobUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
        img.src = blobUrl;
      })
      .catch((err) => {
        console.warn("Failed to cache image:", src, err);
      });
  }

  // ─── Fit canvas to screen ──────────────────────────────
  function fitCanvasToScreen() {
    const area = document.getElementById("canvas-area");
    const wrapper = document.getElementById("canvas-wrapper");
    if (!area || !wrapper) return;

    const areaRect = area.getBoundingClientRect();
    const padding = 16;
    const paddingBottom = 72; // Extra space for the fit button
    const availW = areaRect.width - padding * 2;
    const availH = areaRect.height - padding - paddingBottom;

    const scale = Math.min(availW / CANVAS_SIZE, availH / CANVAS_SIZE, 1);

    // Shift up slightly to vertically center the canvas in the available space above the button
    const offset = -(paddingBottom - padding) / 2;
    wrapper.style.transform = `translateY(${offset}px) scale(${scale})`;
  }

  // ─── Sidebar / Tabs ────────────────────────────────────

  function bindTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const contents = document.querySelectorAll(".tab-content");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        if (!target) return;
        haptic('light');
        tabs.forEach((t) => {
          if (t.dataset.tab) t.classList.remove("active");
        });
        contents.forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        document
          .querySelector(`.tab-content[data-content="${target}"]`)
          .classList.add("active");
      });
    });
  }

  // ─── Add Image to Canvas ──────────────────────────────
  function addImageToCanvas(src, category, thumbW, thumbH) {
    // Lazy-cache: only fetch blob when the user actually uses an image
    cacheImage(src);

    const cached = imageCache.get(src);
    let naturalW = cached ? cached.width : (thumbW || 500);
    let naturalH = cached ? cached.height : (thumbH || 500);

    let w, h;
    if (category === "main" || category === "temp") {
      w = CANVAS_SIZE;
      h = CANVAS_SIZE;
    } else {
      const maxDim = CANVAS_SIZE * 0.4;
      const ratio = Math.min(maxDim / naturalW, maxDim / naturalH);
      w = Math.round(naturalW * ratio);
      h = Math.round(naturalH * ratio);
    }

    const el = {
      id: nextId++,
      type: "image",
      src: src,
      x: (category === "main" || category === "temp") ? 0 : Math.round((CANVAS_SIZE - w) / 2),
      y: (category === "main" || category === "temp") ? 0 : Math.round((CANVAS_SIZE - h) / 2),
      w: w,
      h: h,
      rotation: 0,
      opacity: 100,
      category: category,
      naturalW: naturalW,
      naturalH: naturalH,
    };

    elements.push(el);

    renderCanvas();
    selectElement(el.id);
    openSettingsPanel();
    placeholder.classList.add("hidden");
  }

  // ─── Add Text ─────────────────────────────────────────
  function addTextToCanvas() {
    const el = {
      id: nextId++,
      type: "text",
      text: "To my dearest, <NAME>",
      x: Math.round(CANVAS_SIZE * 0.25),
      y: Math.round(CANVAS_SIZE * 0.45),
      w: 0,
      h: 0,
      rotation: 0,
      opacity: 100,
      fontSize: 30,
      fontFamily: "Inter",
      fontWeight: "600",
      color: "#333333",
    };
    elements.push(el);
    renderCanvas();
    selectElement(el.id);
    openSettingsPanel();
    placeholder.classList.add("hidden");
    haptic('medium');
  }

  const textarea = document.getElementById("prop-text-input");
  if (textarea) {
    textarea.addEventListener("focus", function () {
      // For contenteditable, we can't just call .select(), but we can select all nodes
      const range = document.createRange();
      range.selectNodeContents(this);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  // ─── Render Canvas ─────────────────────────────────────
  function renderCanvas() {
    canvasEl.querySelectorAll(".canvas-element").forEach((el) => el.remove());

    elements.forEach((el) => {
      const div = document.createElement("div");
      div.className =
        "canvas-element" + (el.id === selectedId ? " selected" : "");
      div.dataset.id = el.id;
      div.style.left = el.x + "px";
      div.style.top = el.y + "px";
      div.style.transform = `rotate(${el.rotation}deg)`;
      div.style.opacity = el.opacity / 100;

      // Pointer-events isolation: only the selected element receives touch/mouse
      if (selectedId !== null && el.id !== selectedId) {
        div.style.pointerEvents = "none";
      }

      if (el.type === "image") {
        div.style.width = el.w + "px";
        div.style.height = el.h + "px";
        const img = document.createElement("img");
        img.src = el.src;
        img.draggable = false;
        div.appendChild(img);
      } else if (el.type === "text") {
        div.classList.add("canvas-text");
        div.style.fontSize = el.fontSize + "px";
        div.style.fontFamily = `'${el.fontFamily}', sans-serif`;
        div.style.fontWeight = el.fontWeight;
        div.style.color = el.color;
        // Successive formatting with null safety
        const safeText = el.text || "";
        div.innerHTML = safeText.replace(/\n/g, "<br>");
      }

      // Resize handle
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      handle.dataset.resize = el.id;
      div.appendChild(handle);

      // ── Mouse events ──
      div.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("resize-handle")) return;
        e.stopPropagation();
        selectElement(el.id);
        startDrag(e.clientX, e.clientY, el.id);
      });

      div.addEventListener("dblclick", (e) => {
        if (e.target.classList.contains("resize-handle")) return;
        e.stopPropagation();
        selectElement(el.id);
        openSettingsPanel();
      });

      handle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        selectElement(el.id);
        startResize(e.clientX, e.clientY, el.id);
      });

      // ── Touch events ──
      let lastTapTime = 0;
      div.addEventListener(
        "touchstart",
        (e) => {
          if (e.target.classList.contains("resize-handle")) return;
          e.stopPropagation();
          const t = e.touches[0];
          selectElement(el.id);
          startDrag(t.clientX, t.clientY, el.id);

          const currentTime = new Date().getTime();
          const tapLength = currentTime - lastTapTime;
          if (tapLength < 300 && tapLength > 0) {
            openSettingsPanel();
            e.preventDefault();
          }
          lastTapTime = currentTime;
        },
        { passive: false },
      );

      handle.addEventListener("touchstart", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const t = e.touches[0];
        selectElement(el.id);
        startResize(t.clientX, t.clientY, el.id);
      });

      canvasEl.appendChild(div);
    });

    if (elements.length === 0) {
      placeholder.classList.remove("hidden");
    }

    // Update layers panel if open
    renderLayersPanel();
  }

  // ─── Selection ─────────────────────────────────────────
  function selectElement(id) {
    if (selectedId === id) return; // Prevent unnecessary class changes
    selectedId = id;
    haptic('light');

    // Update visual selection borders + pointer-events isolation
    canvasEl.querySelectorAll(".canvas-element").forEach((elDiv) => {
      const elId = parseInt(elDiv.dataset.id);
      if (elId === id) {
        elDiv.classList.add("selected");
        elDiv.style.pointerEvents = "";
      } else {
        elDiv.classList.remove("selected");
        elDiv.style.pointerEvents = "none";
      }
    });

    updatePropertiesPanel();
    renderLayersPanel();
  }

  function deselectAll() {
    if (selectedId === null) return;
    selectedId = null;

    // Restore pointer-events on all elements + remove selection
    canvasEl.querySelectorAll(".canvas-element").forEach((elDiv) => {
      elDiv.classList.remove("selected");
      elDiv.style.pointerEvents = "";
    });

    closeSettingsPanel();
    const btnSettings = document.getElementById("btn-element-settings");
    if (btnSettings) {
      btnSettings.classList.add("hidden");
      btnSettings.querySelector(".icon-settings").classList.remove("hidden");
      btnSettings.querySelector(".icon-close").classList.add("hidden");
    }
    renderLayersPanel();
  }

  // ─── Drag Logic (unified mouse + touch) ────────────────
  function startDrag(clientX, clientY, id) {
    // Mutex: block if already resizing
    if (resizing) return;
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    haptic('light');

    const canvasRect = canvasEl.getBoundingClientRect();
    const scale = canvasRect.width / CANVAS_SIZE;

    dragging = {
      id,
      startX: clientX,
      startY: clientY,
      elStartX: el.x,
      elStartY: el.y,
      scale,
    };
  }

  function startResize(clientX, clientY, id) {
    // Mutex: block if already dragging
    if (dragging) return;
    const el = elements.find((e) => e.id === id);
    if (!el) return;

    resizing = {
      id,
      startX: clientX,
      startY: clientY,
      startW: el.w,
      startH: el.h,
      startFontSize: el.fontSize || 36,
    };
  }

  let rafPending = false;
  let rafClientX = 0;
  let rafClientY = 0;

  function onPointerMove(clientX, clientY) {
    if (!dragging && !resizing) return;
    rafClientX = clientX;
    rafClientY = clientY;

    if (rafPending) return;
    rafPending = true;

    requestAnimationFrame(processPointerMove);
  }

  function processPointerMove() {
    rafPending = false;
    const clientX = rafClientX;
    const clientY = rafClientY;

    if (dragging) {
      const el = elements.find((e) => e.id === dragging.id);
      if (!el) return;

      const dx = (clientX - dragging.startX) / dragging.scale;
      const dy = (clientY - dragging.startY) / dragging.scale;

      let newX = dragging.elStartX + dx;
      let newY = dragging.elStartY + dy;

      if (snapEnabled) {
        const threshold = 16 / dragging.scale; // Magnetic proximity auto-adjusts based on zoom
        const cx = newX + el.w / 2;
        const cy = newY + el.h / 2;

        let snappedX = false;
        let snappedY = false;

        // X-axis mapping (Center, Left edge, Right edge)
        const snapPointsX = [0, CANVAS_SIZE / 2, CANVAS_SIZE];
        for (let p of snapPointsX) {
          if (Math.abs(newX - p) < threshold) { newX = p; snappedX = p; break; } // Left snap
          if (Math.abs(newX + el.w - p) < threshold) { newX = p - el.w; snappedX = p; break; } // Right snap
          if (Math.abs(cx - p) < threshold) { newX = p - el.w / 2; snappedX = p; break; } // Center snap
        }

        // Y-axis mapping (Center, Top edge, Bottom edge)
        const snapPointsY = [0, CANVAS_SIZE / 2, CANVAS_SIZE];
        for (let p of snapPointsY) {
          if (Math.abs(newY - p) < threshold) { newY = p; snappedY = p; break; } // Top snap
          if (Math.abs(newY + el.h - p) < threshold) { newY = p - el.h; snappedY = p; break; } // Bottom snap
          if (Math.abs(cy - p) < threshold) { newY = p - el.h / 2; snappedY = p; break; } // Center snap
        }

        // Show/Hide DOM Guide lines with Haptics on contact
        const guideX = document.getElementById("guide-x");
        const guideY = document.getElementById("guide-y");

        if (snappedX !== false) {
          if (guideX) {
            guideX.style.left = snappedX + "px";
            if (guideX.classList.contains("hidden")) { guideX.classList.remove("hidden"); haptic("light"); }
          }
        } else {
          if (guideX) guideX.classList.add("hidden");
        }

        if (snappedY !== false) {
          if (guideY) {
            guideY.style.top = snappedY + "px";
            if (guideY.classList.contains("hidden")) { guideY.classList.remove("hidden"); haptic("light"); }
          }
        } else {
          if (guideY) guideY.classList.add("hidden");
        }
      }

      el.x = Math.round(newX);
      el.y = Math.round(newY);

      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) {
        div.style.left = el.x + "px";
        div.style.top = el.y + "px";
      }
    }

    if (resizing) {
      const el = elements.find((e) => e.id === resizing.id);
      if (!el) return;

      const canvasRect = canvasEl.getBoundingClientRect();
      const scale = canvasRect.width / CANVAS_SIZE;
      const dx = (clientX - resizing.startX) / scale;

      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);

      if (el.type === "image") {
        const aspectRatio = resizing.startW / resizing.startH;
        let newW = Math.max(30, resizing.startW + dx);
        el.w = Math.round(newW);
        el.h = Math.round(newW / Math.max(0.1, aspectRatio));
        if (div) {
          div.style.width = el.w + "px";
          div.style.height = el.h + "px";
        }
      } else if (el.type === "text") {
        el.fontSize = Math.max(
          12,
          Math.min(120, Math.round(resizing.startFontSize + dx * 0.5)),
        );
        if (div) {
          div.style.fontSize = el.fontSize + "px";
        }
      }

      // Live update properties panel if it's open
      if (
        selectedId === el.id &&
        !propertiesPanel.classList.contains("hidden")
      ) {
        if (el.type === "image") {
          const baseSize =
            el.category === "main" ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
          const scalePercent = Math.round((el.w / baseSize) * 100);
          setVal("prop-scale", scalePercent);
          setDisplay("prop-scale-val", scalePercent + "%");
        } else {
          setVal("prop-font-size", el.fontSize);
          setDisplay("prop-font-size-val", el.fontSize + "px");
        }
      }
    }
  }

  function onPointerUp() {
    dragging = null;
    resizing = null;
    rafPending = false;

    // Hide snap guides on release
    const guideX = document.getElementById("guide-x");
    const guideY = document.getElementById("guide-y");
    if (guideX) guideX.classList.add("hidden");
    if (guideY) guideY.classList.add("hidden");
  }

  // ─── Canvas Events ─────────────────────────────────────
  function bindCanvasEvents() {
    canvasEl.addEventListener("mousedown", (e) => {
      if (
        e.target === canvasEl ||
        e.target === placeholder ||
        e.target.parentElement === placeholder
      ) {
        deselectAll();
      }
    });

    canvasEl.addEventListener(
      "touchstart",
      (e) => {
        if (
          e.target === canvasEl ||
          e.target === placeholder ||
          e.target.parentElement === placeholder
        ) {
          deselectAll();
        }
      },
      { passive: true },
    );

    // Mouse move/up
    document.addEventListener("mousemove", (e) =>
      onPointerMove(e.clientX, e.clientY),
    );
    document.addEventListener("mouseup", onPointerUp);

    // Touch move/end
    document.addEventListener(
      "touchmove",
      (e) => {
        if (dragging || resizing) {
          e.preventDefault();
          const t = e.touches[0];
          onPointerMove(t.clientX, t.clientY);
        }
      },
      { passive: false },
    );

    document.addEventListener("touchend", onPointerUp);
    document.addEventListener("touchcancel", onPointerUp);
  }

  // ─── Keyboard ──────────────────────────────────────────
  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (!selectedId) return;
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT"
      )
        return;

      const el = elements.find((e) => e.id === selectedId);
      if (!el) return;

      const step = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          deleteSelected();
          e.preventDefault();
          break;
        case "ArrowUp":
          el.y -= step;
          renderCanvas();
          e.preventDefault();
          break;
        case "ArrowDown":
          el.y += step;
          renderCanvas();
          e.preventDefault();
          break;
        case "ArrowLeft":
          el.x -= step;
          renderCanvas();
          e.preventDefault();
          break;
        case "ArrowRight":
          el.x += step;
          renderCanvas();
          e.preventDefault();
          break;
        case "Escape":
          deselectAll();
          e.preventDefault();
          break;
      }
    });
  }

  // ─── Properties Panel ──────────────────────────────────
  function updatePropertiesPanel() {
    const btnSettings = document.getElementById("btn-element-settings");
    const panelTitle = document.getElementById("panel-title");

    if (selectedId === null) {
      closeSettingsPanel();
      if (btnSettings) {
        btnSettings.classList.add("hidden");
        btnSettings.querySelector(".icon-settings").classList.remove("hidden");
        btnSettings.querySelector(".icon-close").classList.add("hidden");
      }
      return;
    }

    const el = elements.find((e) => e.id === selectedId);
    if (!el) {
      closeSettingsPanel();
      if (btnSettings) {
        btnSettings.classList.add("hidden");
        btnSettings.querySelector(".icon-settings").classList.remove("hidden");
        btnSettings.querySelector(".icon-close").classList.add("hidden");
      }
      return;
    }

    if (btnSettings) {
      btnSettings.classList.remove("hidden");
    }

    if (el.type === "image") {
      propsImage.classList.remove("hidden");
      propsText.classList.add("hidden");
      document.getElementById("panel-title").textContent = "Image";

      const baseSize = el.category === "main" ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
      const scalePercent = Math.round((el.w / baseSize) * 100);

      setVal("prop-scale", scalePercent);
      setDisplay("prop-scale-val", scalePercent + "%");
      setVal("prop-rotation", el.rotation);
      setDisplay("prop-rotation-val", el.rotation + "°");
      setVal("prop-opacity", el.opacity);
      setDisplay("prop-opacity-val", el.opacity + "%");
    } else if (el.type === "text") {
      propsText.classList.remove("hidden");
      propsImage.classList.add("hidden");
      document.getElementById("panel-title").textContent = "Text";

      const richInput = document.getElementById("prop-text-input");
      if (richInput) richInput.innerHTML = el.text || "";
      setVal("prop-font-size", el.fontSize);
      setDisplay("prop-font-size-val", el.fontSize + "px");
      document.getElementById("prop-font-family").value = el.fontFamily;
      document.getElementById("prop-text-color").value = el.color;
      document.getElementById("prop-font-weight").value = el.fontWeight;
      setVal("prop-text-rotation", el.rotation);
      setDisplay("prop-text-rotation-val", el.rotation + "°");
      setVal("prop-text-opacity", el.opacity);
      setDisplay("prop-text-opacity-val", el.opacity + "%");
      syncTextColorPicker();
    }
  }

  function setVal(id, v) {
    document.getElementById(id).value = v;
  }
  function setDisplay(id, v) {
    document.getElementById(id).textContent = v;
  }

  function openSettingsPanel() {
    if (propertiesPanel && (propertiesPanel.classList.contains("hidden") || propertiesPanel.classList.contains("closing-to-fab"))) {
      setToggleVisibility(false);
      haptic("light");
      propertiesPanel.classList.remove("hidden");
      propertiesPanel.classList.remove("closing-to-fab");
      propertiesPanel.style.transform = "";
      propertiesPanel.style.opacity = "";
      propertiesPanel.style.borderRadius = "";
      const btnSettings = document.getElementById("btn-element-settings");
      if (btnSettings) {
        btnSettings.querySelector(".icon-settings").classList.add("hidden");
        btnSettings.querySelector(".icon-close").classList.remove("hidden");
      }
    }
  }

  function closeSettingsPanel() {
    if (!propertiesPanel || propertiesPanel.classList.contains("hidden")) return;
    setToggleVisibility(true);

    const btnSettings = document.getElementById("btn-element-settings");
    const panelRect = propertiesPanel.getBoundingClientRect();

    // Default target: bottom-right of viewport (fallback if button is hidden/gone)
    let targetX = window.innerWidth - 40;
    let targetY = window.innerHeight - 40;

    if (btnSettings && !btnSettings.classList.contains("hidden")) {
      const btnRect = btnSettings.getBoundingClientRect();
      targetX = btnRect.left + btnRect.width / 2;
      targetY = btnRect.top + btnRect.height / 2;
    }

    // Calculate how far the panel center needs to translate
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelCenterY = panelRect.top + panelRect.height / 2;
    const dx = targetX - panelCenterX;
    const dy = targetY - panelCenterY;

    propertiesPanel.style.pointerEvents = "none";

    const anim = propertiesPanel.animate([
      { transform: "scale(1) translate(0, 0)", opacity: 1, borderRadius: "28px 28px 0 0" },
      { transform: `scale(0.05) translate(${dx}px, ${dy}px)`, opacity: 0, borderRadius: "999px" }
    ], {
      duration: 400,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards"
    });

    anim.onfinish = () => {
      propertiesPanel.classList.add("hidden");
      propertiesPanel.style.pointerEvents = "";
      propertiesPanel.style.transform = "";
      propertiesPanel.style.opacity = "";
      propertiesPanel.style.borderRadius = "";
      anim.cancel();
    };
  }

  function bindPropertiesPanel() {
    // Fading effect when using sliders
    const propPanel = document.getElementById("properties-panel");
    const updateSliderFade = (isSliding, e) => {
      if (!isSliding) {
        propPanel.classList.remove("slider-active");
        propPanel
          .querySelectorAll(".is-sliding")
          .forEach((el) => el.classList.remove("is-sliding"));
        return;
      }
      propPanel.classList.add("slider-active");
      const row = e.target.closest(".prop-row, .prop-row-inline");
      if (row) row.classList.add("is-sliding");
    };

    document
      .querySelectorAll('#properties-panel input[type="range"]')
      .forEach((slider) => {
        slider.addEventListener("mousedown", (e) => updateSliderFade(true, e), {
          passive: true,
        });
        slider.addEventListener(
          "touchstart",
          (e) => updateSliderFade(true, e),
          { passive: true },
        );
      });
    document.addEventListener("mouseup", () => updateSliderFade(false));
    document.addEventListener("touchend", () => updateSliderFade(false));

    // Done button for text editing
    const btnDone = document.getElementById("btn-text-done");
    if (btnDone) {
      btnDone.addEventListener("click", () => {
        haptic("medium");
        const textarea = document.getElementById("prop-text-content");
        if (textarea) textarea.blur();
      });
    }

    // Toggle via close button
    document.getElementById("btn-close-panel").addEventListener("click", () => {
      haptic("light");
      closeSettingsPanel();
      const btnSettings = document.getElementById("btn-element-settings");
      if (btnSettings) {
        btnSettings.querySelector(".icon-settings").classList.remove("hidden");
        btnSettings.querySelector(".icon-close").classList.add("hidden");
      }
    });

    // Toggle via floating settings button
    const btnSettings = document.getElementById("btn-element-settings");
    if (btnSettings) {
      btnSettings.addEventListener("click", () => {
        haptic("light");
        if (propertiesPanel.classList.contains("hidden") || propertiesPanel.classList.contains("closing-to-fab")) {
          openSettingsPanel();
        } else {
          closeSettingsPanel();
          btnSettings.querySelector(".icon-settings").classList.remove("hidden");
          btnSettings.querySelector(".icon-close").classList.add("hidden");
        }
      });
    }

    // Image properties
    bindRange("prop-scale", "prop-scale-val", "%", (val) => {
      const el = getSelected();
      if (!el || el.type !== "image") return;
      const aspect = el.naturalW / el.naturalH || 1;
      const baseSize = el.category === "main" ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
      el.w = Math.round((baseSize * val) / 100);
      el.h = Math.round(el.w / aspect);
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) {
        div.style.width = el.w + "px";
        div.style.height = el.h + "px";
      }
    });

    bindRange("prop-rotation", "prop-rotation-val", "°", (val) => {
      const el = getSelected();
      if (!el) return;
      el.rotation = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.transform = `rotate(${el.rotation}deg)`;
    });

    bindRange("prop-opacity", "prop-opacity-val", "%", (val) => {
      const el = getSelected();
      if (!el) return;
      el.opacity = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.opacity = el.opacity / 100;
    });

    // Text properties (Visual Rich Input)
    const richInput = document.getElementById("prop-text-input");
    if (richInput) {
      richInput.addEventListener("input", () => {
        const el = getSelected();
        if (!el || el.type !== "text") return;
        el.text = richInput.innerHTML;
        const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
        if (div) div.innerHTML = el.text;
      });

      // Special paste handler to prevent rich formatting from other sites
      richInput.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      });
    }

    // Visual Formatting Buttons (execCommand for abstracted UI)
    const btnBold = document.getElementById("btn-format-bold");
    const btnItalic = document.getElementById("btn-format-italic");
    const btnUnderline = document.getElementById("btn-format-underline");

    if (btnBold) btnBold.addEventListener("click", () => {
      document.execCommand("bold", false, null);
      haptic("light");
    });
    if (btnItalic) btnItalic.addEventListener("click", () => {
      document.execCommand("italic", false, null);
      haptic("light");
    });
    if (btnUnderline) btnUnderline.addEventListener("click", () => {
      document.execCommand("underline", false, null);
      haptic("light");
    });


    bindRange("prop-font-size", "prop-font-size-val", "px", (val) => {
      const el = getSelected();
      if (!el || el.type !== "text") return;
      el.fontSize = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.fontSize = el.fontSize + "px";
    });

    document
      .getElementById("prop-font-family")
      .addEventListener("change", (e) => {
        const el = getSelected();
        if (!el || el.type !== "text") return;
        el.fontFamily = e.target.value;
        const div = document.querySelector(
          `.canvas-element[data-id="${el.id}"]`,
        );
        if (div) div.style.fontFamily = `'${el.fontFamily}', sans-serif`;
      });

    // Color picker: use iro.js if available, otherwise fall back to native input
    initColorPickers();

    // Color swatches and Floating Picker
    bindSwatch("swatch-text-color", "prop-text-color", (color) => {
      const el = getSelected();
      if (!el || el.type !== "text") return;
      el.color = color;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.color = el.color;
      // Sync hex display
      const hexInput = document.getElementById("text-color-hex");
      if (hexInput) hexInput.value = el.color;
    });

    // Native color input for immediate feedback (still kept as backup/sink)
    document
      .getElementById("prop-text-color")
      .addEventListener("input", (e) => {
        const el = getSelected();
        if (!el || el.type !== "text") return;
        el.color = e.target.value;
        const div = document.querySelector(
          `.canvas-element[data-id="${el.id}"]`,
        );
        if (div) div.style.color = el.color;
        // Sync hex display and iro picker
        const hexInput = document.getElementById("text-color-hex");
        if (hexInput) hexInput.value = el.color;
        if (textColorPicker) textColorPicker.color.hexString = el.color;
      });

    document
      .getElementById("prop-font-weight")
      .addEventListener("change", (e) => {
        const el = getSelected();
        if (!el || el.type !== "text") return;
        el.fontWeight = e.target.value;
        const div = document.querySelector(
          `.canvas-element[data-id="${el.id}"]`,
        );
        if (div) div.style.fontWeight = el.fontWeight;
      });

    bindRange("prop-text-rotation", "prop-text-rotation-val", "°", (val) => {
      const el = getSelected();
      if (!el) return;
      el.rotation = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.transform = `rotate(${el.rotation}deg)`;
    });

    bindRange("prop-text-opacity", "prop-text-opacity-val", "%", (val) => {
      const el = getSelected();
      if (!el) return;
      el.opacity = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.opacity = el.opacity / 100;
    });

    // Layer actions
    document.querySelectorAll("#btn-bring-front").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (!selectedId) return;
        haptic("light");
        const idx = elements.findIndex((e) => e.id === selectedId);
        if (idx < elements.length - 1) {
          const el = elements.splice(idx, 1)[0];
          elements.push(el);
          renderCanvas();
        }
      }),
    );

    document.querySelectorAll("#btn-send-back").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (!selectedId) return;
        haptic("light");
        const idx = elements.findIndex((e) => e.id === selectedId);
        if (idx > 0) {
          const el = elements.splice(idx, 1)[0];
          elements.unshift(el);
          renderCanvas();
        }
      }),
    );

    // Layers panel toggle
    const layersBtn = document.getElementById("btn-toggle-layers");
    if (layersBtn) {
      layersBtn.addEventListener("click", () => {
        haptic("light");
        toggleLayersPanel();
      });
    }

    document
      .querySelectorAll("#btn-delete-el")
      .forEach((btn) => btn.addEventListener("click", deleteSelected));

    // Initialize text presets
    renderTextPresets();
  }

  function bindRange(inputId, valId, suffix, callback) {
    const input = document.getElementById(inputId);
    const valSpan = document.getElementById(valId);
    input.addEventListener("input", () => {
      const val = parseInt(input.value);
      valSpan.textContent = val + suffix;
      callback(val);
    });
  }

  // ─── Header Buttons ───────────────────────────────────
  function bindHeaderButtons() {
    document
      .getElementById("btn-add-text")
      .addEventListener("click", addTextToCanvas);

    document.getElementById("btn-clear").addEventListener("click", () => {
      if (elements.length === 0) return;
      haptic('heavy');
      if (confirm("Clear all elements from the canvas?")) {
        elements = [];
        selectedId = null;
        nextId = 1;
        renderCanvas();
        propertiesPanel.classList.add("hidden");
      }
    });

    document
      .getElementById("btn-download")
      .addEventListener("click", showDownloadModal);

    // Fit canvas button
    const fitBtn = document.getElementById("btn-fit-screen");
    if (fitBtn) fitBtn.addEventListener("click", () => {
      haptic("light");
      fitCanvasToScreen();
      showToast("Canvas fitted to screen");
    });

    // Grid Toggle Button
    const gridBtn = document.getElementById("btn-toggle-grid");
    const gridOverlay = document.getElementById("grid-overlay");
    if (gridBtn && gridOverlay) {
      gridBtn.addEventListener("click", () => {
        gridEnabled = !gridEnabled;
        haptic("light");
        if (gridEnabled) {
          gridOverlay.classList.remove("hidden");
          gridBtn.style.background = "var(--md-sys-color-primary-container)";
          gridBtn.style.color = "var(--md-sys-color-on-primary-container)";
        } else {
          gridOverlay.classList.add("hidden");
          gridBtn.style.background = "transparent";
          gridBtn.style.color = "inherit";
        }
        showToast(gridEnabled ? "Composition Grid: ON" : "Composition Grid: OFF");
      });
    }

    // Snap Toggle Button
    const snapBtn = document.getElementById("btn-toggle-snap");
    if (snapBtn) {
      snapBtn.addEventListener("click", () => {
        snapEnabled = !snapEnabled;
        haptic("light");
        if (snapEnabled) {
          snapBtn.style.background = "var(--md-sys-color-primary-container)";
          snapBtn.style.color = "var(--md-sys-color-on-primary-container)";
        } else {
          snapBtn.style.background = "transparent";
          snapBtn.style.color = "inherit";
        }
        showToast(snapEnabled ? "Magnetic Snapping: ON" : "Magnetic Snapping: OFF");
      });
    }

    // Simple Mode "Add Text" button (inside backdrop grid)
    const addTextSimpleBtn = document.getElementById("btn-add-text-simple");
    if (addTextSimpleBtn) {
      addTextSimpleBtn.addEventListener("click", () => {
        addTextToCanvas();
        haptic("success");
      });
    }
  }

  // ─── Mode Toggle ─────────────────────────────────────────
  function bindModeToggle() {
    const btnSimple = document.getElementById("btn-mode-simple");
    const btnPro = document.getElementById("btn-mode-pro");

    if (!btnSimple || !btnPro) return;

    // Start as Simple by default on every load
    simpleMode = true;
    applyMode();

    btnSimple.addEventListener("click", () => {
      if (simpleMode) return;
      simpleMode = true;
      localStorage.setItem("faithcard_mode", "simple");
      haptic("medium");
      applyMode();
      showToast("Simple Mode");
    });

    btnPro.addEventListener("click", () => {
      if (!simpleMode) return;
      simpleMode = false;
      localStorage.setItem("faithcard_mode", "pro");
      haptic("medium");
      applyMode();
      showToast("Pro Mode");
    });
  }

  function applyMode() {
    const btnSimple = document.getElementById("btn-mode-simple");
    const btnPro = document.getElementById("btn-mode-pro");

    if (simpleMode) {
      document.body.classList.add("simple-mode");
      btnSimple.classList.add("active");
      btnPro.classList.remove("active");

      // Force templates tab in simple mode
      const backdropTab = document.querySelector('.tab-btn[data-tab="temp"]');
      if (backdropTab) backdropTab.click();

      // Close panels that might clutter
      if (typeof layersPanelOpen !== "undefined" && layersPanelOpen) {
        toggleLayersPanel();
      }
    } else {
      document.body.classList.remove("simple-mode");
      btnSimple.classList.remove("active");
      btnPro.classList.add("active");

      // Return to backdrops when switching to Pro
      const backdropTab = document.querySelector('.tab-btn[data-tab="main"]');
      if (backdropTab) backdropTab.click();
    }
  }

  // ─── Toast Notifications ─────────────────────────────────
  let toastTimeout;
  window.showToast = function (message) {
    const container = document.getElementById("toast-container");
    const msgEl = document.getElementById("toast-message");
    if (!container || !msgEl) return;

    msgEl.textContent = message;
    container.classList.remove("hidden");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      container.classList.add("hidden");
    }, 2000);
  };

  // ─── Download Modal ────────────────────────────────────
  function bindModal() {
    document
      .getElementById("btn-modal-cancel")
      .addEventListener("click", hideDownloadModal);
    document
      .getElementById("btn-modal-save")
      .addEventListener("click", executeDownload);

    // Press Enter to save
    downloadNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        executeDownload();
      }
      if (e.key === "Escape") {
        hideDownloadModal();
      }
    });

    // Click overlay to close
    downloadModal.addEventListener("click", (e) => {
      if (e.target === downloadModal) {
        hideDownloadModal();
      }
    });

    document.querySelectorAll(".btn-custom-bg").forEach(btn => {
      btn.addEventListener("click", () => {
        haptic("light");
        setToggleVisibility(false);
        document.getElementById("bgcolor-modal").classList.remove("hidden");
      });
    });
  }

  function bindBgColorModal() {
    const modal = document.getElementById("bgcolor-modal");
    if (!modal) return;

    document.getElementById("btn-bgcolor-close").addEventListener("click", () => {
      haptic("light");
      setToggleVisibility(true);
      modal.classList.add("hidden");
    });

    // Tabs
    const tabSolid = document.getElementById("btn-tab-solid");
    const tabGrad = document.getElementById("btn-tab-gradient");
    const secSolid = document.getElementById("bgcolor-solid-section");
    const secGrad = document.getElementById("bgcolor-gradient-section");

    function setTab(type) {
      haptic("light");
      bgConfig.type = type;
      if (type === "solid") {
        tabSolid.style.background = "var(--md-sys-color-primary)";
        tabSolid.style.color = "white";
        tabGrad.style.background = "transparent";
        tabGrad.style.color = "var(--md-sys-color-on-surface)";
        secSolid.classList.remove("hidden");
        secGrad.classList.add("hidden");
      } else {
        tabGrad.style.background = "var(--md-sys-color-primary)";
        tabGrad.style.color = "white";
        tabSolid.style.background = "transparent";
        tabSolid.style.color = "var(--md-sys-color-on-surface)";
        secGrad.classList.remove("hidden");
        secSolid.classList.add("hidden");
      }
    }

    tabSolid.addEventListener("click", () => setTab("solid"));
    tabGrad.addEventListener("click", () => setTab("gradient"));

    const gradAngle = document.getElementById("bg-color-grad-angle");
    const gradAngleVal = document.getElementById("bg-color-grad-angle-val");
    gradAngle.addEventListener("input", (e) => {
      gradAngleVal.textContent = e.target.value + "°";
    });

    // Swatches for BG Color Modal
    bindSwatch("swatch-bg-solid", "bg-color-solid-picker", (color) => {
      // Logic handled by apply button or live?
      // In this app, it seems most things are live or handled in the Apply button
    });
    bindSwatch("swatch-bg-grad-1", "bg-color-grad-1", (color) => { });
    bindSwatch("swatch-bg-grad-2", "bg-color-grad-2", (color) => { });

    // Apply button
    document.getElementById("btn-bgcolor-apply").addEventListener("click", () => {
      setToggleVisibility(true);
      bgConfig.solidColor = document.getElementById("bg-color-solid-picker").value;
      bgConfig.gradColor1 = document.getElementById("bg-color-grad-1").value;
      bgConfig.gradColor2 = document.getElementById("bg-color-grad-2").value;
      bgConfig.gradAngle = parseInt(gradAngle.value, 10);

      applyCanvasBackground();
      modal.classList.add("hidden");
      haptic("success");
    });
  }

  function applyCanvasBackground() {
    if (bgConfig.type === "solid") {
      canvasEl.style.background = bgConfig.solidColor;
    } else {
      canvasEl.style.background = `linear-gradient(${bgConfig.gradAngle}deg, ${bgConfig.gradColor1}, ${bgConfig.gradColor2})`;
    }
  }

  let saveTimer = null;
  function showDownloadModal() {
    setToggleVisibility(false);
    haptic("light");
    deselectAll();
    downloadNameInput.value = "";
    downloadModal.classList.remove("hidden");

    // Countdown logic for the Save button
    const saveBtn = document.getElementById("btn-modal-save");
    const saveBtnText = document.getElementById("save-button-text");
    if (saveBtn && saveBtnText) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.6";
      saveBtn.style.cursor = "not-allowed";

      let secondsLeft = 5;
      saveBtnText.textContent = `Save (${secondsLeft})`;

      if (saveTimer) clearInterval(saveTimer);
      saveTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          saveBtnText.textContent = `Save (${secondsLeft})`;
        } else {
          clearInterval(saveTimer);
          saveBtn.disabled = false;
          saveBtn.style.opacity = "1";
          saveBtn.style.cursor = "pointer";
          saveBtnText.textContent = "Save" + "\u00A0".repeat(6);
          haptic("light");
        }
      }, 1000);
    }


  }

  function hideDownloadModal() {
    setToggleVisibility(true);
    haptic("light");
    downloadModal.classList.add("hidden");

    // Reset save button if closed mid-timer
    if (saveTimer) clearInterval(saveTimer);
    const saveBtn = document.getElementById("btn-modal-save");
    const saveBtnText = document.getElementById("save-button-text");
    if (saveBtn && saveBtnText) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
      saveBtn.style.cursor = "pointer";
      saveBtnText.textContent = "Save";
    }
  }

  function executeDownload() {
    const nameVal = downloadNameInput.value.trim();
    const filename = nameVal ? `${nameVal}-card.png` : "card.png";
    hideDownloadModal();
    downloadPNG(filename);
  }

  // ─── Export to PNG (fixed: uses cached data URLs) ──────
  function downloadPNG(filename) {
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_SIZE;
    offscreen.height = CANVAS_SIZE;
    const ctx = offscreen.getContext("2d");

    // Apply Solid or Gradient Background natively to HTML5 canvas engine
    if (bgConfig.type === "solid") {
      ctx.fillStyle = bgConfig.solidColor;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    } else {
      // Correctly map CSS linear-gradient angle to HTML5 Cartesian coordinates within a square
      const cx = CANVAS_SIZE / 2;
      const cy = CANVAS_SIZE / 2;
      const angleRad = bgConfig.gradAngle * Math.PI / 180;
      // Calculate radius that bounds the square for corner-to-corner filling
      const r = Math.abs((CANVAS_SIZE / 2) * Math.sin(angleRad)) + Math.abs((CANVAS_SIZE / 2) * Math.cos(angleRad));

      const x1 = cx - Math.sin(angleRad) * r;
      const y1 = cy + Math.cos(angleRad) * r;
      const x2 = cx + Math.sin(angleRad) * r;
      const y2 = cy - Math.cos(angleRad) * r;

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, bgConfig.gradColor1);
      grad.addColorStop(1, bgConfig.gradColor2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    // Load all image elements using cached blob URLs
    const loadPromises = elements.map((el) => {
      if (el.type === "image") {
        return new Promise((resolve) => {
          const cached = imageCache.get(el.src);
          if (!cached) {
            // Fallback: fetch the image fresh as a blob
            fetch(el.src)
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => resolve({ el, img });
                img.onerror = () => resolve({ el, img: null });
                img.src = url;
              })
              .catch(() => resolve({ el, img: null }));
            return;
          }
          const img = new Image();
          img.onload = () => resolve({ el, img });
          img.onerror = () => {
            console.warn("Failed to load for export:", el.src);
            resolve({ el, img: null });
          };
          img.src = cached.blobUrl;
        });
      } else {
        return Promise.resolve({ el, img: null });
      }
    });

    const overlayToggle = document.getElementById("jy-overlay-toggle");
    const overlaySelect = document.getElementById("jy-overlay-select");
    if (overlayToggle && overlayToggle.checked && overlaySelect) {
      const src = overlaySelect.value;
      const p = new Promise((resolve) => {
        const cached = imageCache.get(src);
        const img = new Image();
        img.onload = () => resolve({ isOverlay: true, img });
        img.onerror = () => resolve({ isOverlay: true, img: null });
        img.src = cached ? cached.blobUrl : src;
      });
      loadPromises.push(p);
    }

    Promise.all(loadPromises).then((results) => {
      results.forEach((res) => {
        if (res.isOverlay) return;
        const { el, img } = res;
        ctx.save();
        ctx.globalAlpha = el.opacity / 100;

        if (el.type === "image" && img) {
          if (el.rotation !== 0) {
            const cx = el.x + el.w / 2;
            const cy = el.y + el.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate((el.rotation * Math.PI) / 180);
            ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
          } else {
            ctx.drawImage(img, el.x, el.y, el.w, el.h);
          }
        } else if (el.type === "text") {
          ctx.font = `${el.fontWeight} ${el.fontSize}px '${el.fontFamily}', sans-serif`;
          ctx.fillStyle = el.color;
          ctx.textBaseline = "top";

          if (el.rotation !== 0) {
            ctx.translate(el.x, el.y);
            ctx.rotate((el.rotation * Math.PI) / 180);
            ctx.fillText(el.text, 0, 0);
          } else {
            ctx.fillText(el.text, el.x, el.y);
          }
        }

        ctx.restore();
      });

      // Overlay rendering must go on top
      const overlayRes = results.find((r) => r.isOverlay);
      if (overlayRes && overlayRes.img) {
        ctx.globalAlpha = 1; // force 100% opacity for top overlay
        ctx.drawImage(overlayRes.img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }

      // Trigger download
      offscreen.toBlob((blob) => {
        if (!blob) {
          alert("Failed to generate image. Please try again.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    });
  }

  // ─── Layers Panel ──────────────────────────────────────
  let layersPanelOpen = false;

  function toggleLayersPanel() {
    const panel = document.getElementById("layers-panel");
    const btn = document.getElementById("btn-toggle-layers");
    if (!panel) return;

    layersPanelOpen = !layersPanelOpen;
    if (layersPanelOpen) {
      panel.classList.remove("hidden");
      if (btn) {
        btn.style.background = "var(--md-sys-color-primary-container)";
        btn.style.color = "var(--md-sys-color-on-primary-container)";
      }
      renderLayersPanel();
    } else {
      panel.classList.add("hidden");
      if (btn) {
        btn.style.background = "";
        btn.style.color = "";
      }
    }
  }

  function renderLayersPanel() {
    const list = document.getElementById("layers-list");
    if (!list || !layersPanelOpen) return;

    list.innerHTML = "";

    if (elements.length === 0) {
      list.innerHTML = '<div class="layers-empty">No elements on canvas</div>';
      return;
    }

    // Show in reverse order (top layer first)
    const reversed = [...elements].reverse();
    reversed.forEach((el, visualIdx) => {
      const actualIdx = elements.length - 1 - visualIdx;
      const row = document.createElement("div");
      row.className = "layer-row" + (el.id === selectedId ? " layer-selected" : "");
      row.dataset.id = el.id;

      const icon = el.type === "image" ? "🖼️" : "🔤";
      let label = "";
      if (el.type === "text") {
        const safeText = el.text || "";
        // Strip HTML tags for the layer label to keep it clean
        const plainText = safeText.replace(/<[^>]*>/g, "");
        label = plainText.length > 18 ? plainText.substring(0, 18) + "…" : (plainText || "Text");
      } else {
        if (el.category === "main") {
          label = "Backdrop";
        } else {
          // Extract filename from src (e.g., cross_01.png -> cross_01)
          const fileName = el.src ? el.src.split("/").pop().split(".")[0] : "";
          label = fileName || `Element ${el.id}`;
        }
      }

      row.innerHTML = `
        <span class="layer-icon">${icon}</span>
        <span class="layer-label">${label}</span>
        <div class="layer-actions">
          <button class="layer-btn layer-up" title="Move Up" ${actualIdx >= elements.length - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button class="layer-btn layer-down" title="Move Down" ${actualIdx <= 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      `;

      // Click row to select
      row.addEventListener("click", (e) => {
        if (e.target.closest(".layer-btn")) return;
        selectElement(el.id);
      });

      // Double-click row to open settings
      row.addEventListener("dblclick", (e) => {
        if (e.target.closest(".layer-btn")) return;
        selectElement(el.id);
        openSettingsPanel();
      });

      // Move up (increase z-index = move later in array)
      const upBtn = row.querySelector(".layer-up");
      upBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (actualIdx < elements.length - 1) {
          haptic("light");
          const item = elements.splice(actualIdx, 1)[0];
          elements.splice(actualIdx + 1, 0, item);
          renderCanvas();
        }
      });

      // Move down (decrease z-index = move earlier in array)
      const downBtn = row.querySelector(".layer-down");
      downBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (actualIdx > 0) {
          haptic("light");
          const item = elements.splice(actualIdx, 1)[0];
          elements.splice(actualIdx - 1, 0, item);
          renderCanvas();
        }
      });

      list.appendChild(row);
    });
  }

  // ─── Color Picker (iro.js) ─────────────────────────────
  const COLOR_PRESETS = [
    "#FFFFFF", "#000000", "#333333", "#666666",
    "#FF4444", "#FF8800", "#FFCC00", "#44BB44",
    "#2196F3", "#9C27B0", "#E91E63", "#00BCD4",
    "#FFB6C1", "#DDA0DD", "#87CEFA", "#98FB98",
    "#FFDAB9", "#F0E68C", "#D4AF37", "#C0C0C0"
  ];

  function initColorPickers() {
    if (typeof iro === "undefined") {
      console.warn("iro.js not loaded, using native color inputs");
      return;
    }
    // We now use a global floating picker managed by openColorPopover
  }

  // Sync text color picker to selected element
  function syncTextColorPicker() {
    const el = getSelected();
    if (el && el.type === "text") {
      const swatch = document.getElementById("swatch-text-color");
      if (swatch) swatch.style.background = el.color;
      const hexInput = document.getElementById("text-color-hex");
      if (hexInput) hexInput.value = el.color;
    }
  }

  // ─── Floating Color Picker Manager ─────────────────────
  let globalPicker = null;

  function bindSwatch(swatchId, triggerInputId, callback) {
    const swatch = document.getElementById(swatchId);
    const input = document.getElementById(triggerInputId);
    if (!swatch || !input) return;

    swatch.addEventListener("click", () => {
      haptic("light");
      openColorPopover(swatch, input.value, (hex) => {
        input.value = hex;
        swatch.style.background = hex;
        callback(hex);
      });
    });
  }

  function openColorPopover(anchorEl, initialColor, onColorChange) {
    const popover = document.getElementById("color-popover");
    const mount = document.getElementById("popover-picker-mount");
    const hexInput = document.getElementById("popover-hex-input");
    const presets = document.getElementById("popover-presets");
    const closeBtn = document.getElementById("btn-popover-close");

    if (!popover || !mount) return;

    // Position popover
    popover.classList.remove("hidden");

    // "Centered" as requested: Centered horizontally on screen, fixed height from bottom
    let left = (window.innerWidth - popover.offsetWidth) / 2;
    let bottom = 80; // Above the navigation bar

    popover.style.bottom = bottom + "px";
    popover.style.top = "auto";
    popover.style.left = left + "px";
    popover.style.transformOrigin = "bottom center";

    // Initialize or update iro picker
    if (!globalPicker) {
      globalPicker = new iro.ColorPicker(mount, {
        width: 200,
        color: initialColor,
        borderWidth: 2,
        borderColor: "rgba(255,255,255,0.15)",
        // simple iro layout
        layout: [
          { component: iro.ui.Wheel, options: { wheelLightness: false } },
          { component: iro.ui.Slider, options: { sliderType: "value" } },
        ]
      });

      // Build presets once
      presets.innerHTML = "";
      COLOR_PRESETS.forEach(hex => {
        const pSwatch = document.createElement("div");
        pSwatch.className = "popover-swatch";
        pSwatch.style.background = hex;
        pSwatch.addEventListener("click", () => {
          haptic("light");
          globalPicker.color.hexString = hex;
        });
        presets.appendChild(pSwatch);
      });

      hexInput.addEventListener("change", () => {
        const val = hexInput.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
          globalPicker.color.hexString = val;
        }
      });

      closeBtn.addEventListener("click", () => {
        haptic("medium");
        popover.classList.add("hidden");
      });

      // Click outside to close
      document.addEventListener("mousedown", (e) => {
        if (!popover.classList.contains("hidden") && !popover.contains(e.target) && !anchorEl.contains(e.target)) {
          popover.classList.add("hidden");
        }
      });
      document.addEventListener("touchstart", (e) => {
        if (!popover.classList.contains("hidden") && !popover.contains(e.target) && !anchorEl.contains(e.target)) {
          popover.classList.add("hidden");
        }
      }, { passive: true });
    } else {
      globalPicker.color.hexString = initialColor;
    }

    hexInput.value = initialColor.toUpperCase();

    // Remove previous listeners using a clever trick: re-cloning or just updating a reference
    // Actually, we can just update the 'onColorChange' logic
    globalPicker.off("color:change"); // iro.js supports this
    globalPicker.on("color:change", (color) => {
      onColorChange(color.hexString);
      hexInput.value = color.hexString.toUpperCase();
    });
  }

  // ─── Text Presets ──────────────────────────────────────
  const TEXT_PRESETS_DATA = [
    { name: "Elegant", text: "He is risen", fontFamily: "Dancing Script", color: "#d0bcff", fontSize: 48, fontWeight: "700" },
    { name: "Modern", text: "He is risen", fontFamily: "Montserrat", color: "#ffffff", fontSize: 42, fontWeight: "700" },
    { name: "Golden", text: "He is risen", fontFamily: "Cinzel", color: "#fde047", fontSize: 44, fontWeight: "700" },
    { name: "Classic", text: "He is risen", fontFamily: "Playfair Display", color: "#f9a8d4", fontSize: 46, fontWeight: "600" },
    { name: "Playful", text: "He is risen", fontFamily: "Caveat", color: "#44BB44", fontSize: 52, fontWeight: "700" },
    { name: "Bold", text: "He is risen", fontFamily: "Russo One", color: "#FF8800", fontSize: 40, fontWeight: "400" },
    { name: "Script", text: "He is risen", fontFamily: "Satisfy", color: "#eaddff", fontSize: 48, fontWeight: "400" }
  ];

  function renderTextPresets() {
    const container = document.getElementById("text-presets-container");
    if (!container) return;

    // Pick 5 random presets as requested
    const shuffled = [...TEXT_PRESETS_DATA].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 5);

    container.innerHTML = "";
    selected.forEach(preset => {
      const chip = document.createElement("div");
      chip.className = "text-preset-chip";
      chip.textContent = preset.name;
      chip.style.fontFamily = `'${preset.fontFamily}', sans-serif`;

      chip.addEventListener("click", () => {
        haptic("medium");
        applyTextPreset(preset);
      });

      container.appendChild(chip);
    });
  }

  function applyTextPreset(preset) {
    const el = getSelected();
    if (!el || el.type !== "text") {
      // If no text selected, maybe create a new one? 
      // For now, let's just toast
      if (!el) showToast("Select a text element first");
      return;
    }

    // Update data
    el.text = preset.text;
    el.fontFamily = preset.fontFamily;
    el.color = preset.color;
    el.fontSize = preset.fontSize;
    el.fontWeight = preset.fontWeight;

    // Update UI inputs
    const richInput = document.getElementById("prop-text-input");
    if (richInput) richInput.innerHTML = el.text;

    const fontFamilySelect = document.getElementById("prop-font-family");
    if (fontFamilySelect) fontFamilySelect.value = el.fontFamily;

    const fontSizeRange = document.getElementById("prop-font-size");
    if (fontSizeRange) {
      fontSizeRange.value = el.fontSize;
      const valLabel = document.getElementById("prop-font-size-val");
      if (valLabel) valLabel.textContent = el.fontSize + "px";
    }

    const fontWeightSelect = document.getElementById("prop-font-weight");
    if (fontWeightSelect) fontWeightSelect.value = el.fontWeight;

    const colorInput = document.getElementById("prop-text-color");
    if (colorInput) colorInput.value = el.color;

    const hexInput = document.getElementById("text-color-hex");
    if (hexInput) hexInput.value = el.color.toUpperCase();

    const swatch = document.getElementById("swatch-text-color");
    if (swatch) swatch.style.background = el.color;

    // Update DOM element directly for immediate feedback
    const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
    if (div) {
      div.innerHTML = el.text;
      div.style.fontFamily = `'${el.fontFamily}', sans-serif`;
      div.style.color = el.color;
      div.style.fontSize = el.fontSize + "px";
      div.style.fontWeight = el.fontWeight;
    }

    // Sync global picker if open
    if (globalPicker) {
      globalPicker.color.hexString = el.color;
    }

    showToast(`Applied ${preset.name} style`);
  }

  // ─── Helpers ───────────────────────────────────────────
  function getSelected() {
    return elements.find((e) => e.id === selectedId) || null;
  }

  function deleteSelected() {
    if (!selectedId) return;
    haptic('medium');
    elements = elements.filter((e) => e.id !== selectedId);
    deselectAll();
    renderCanvas();
  }

  function setToggleVisibility(visible) {
    const bar = document.getElementById("top-toggle-bar");
    if (!bar) return;
    if (visible) {
      bar.classList.remove("hidden-soft");
    } else {
      bar.classList.add("hidden-soft");
    }
  }

  // ─── Kick Off ──────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();
