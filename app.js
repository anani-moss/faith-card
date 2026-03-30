/**
 * Easter Card Composer — Canvas Composition Engine
 * Mobile-first with touch + mouse support.
 * Fixed image export: pre-caches images as data URLs.
 */

(function () {
  'use strict';

  // ─── Image Library (populated dynamically) ─────────────
  const IMAGE_LIBRARY = {
    main: [],
    wish: [],
    decor: []
  };

  // ─── State ─────────────────────────────────────────────
  const CANVAS_SIZE = 1080;
  let elements = [];
  let nextId = 1;
  let selectedId = null;
  let dragging = null;
  let resizing = null;

  // Pre-cached images as data URLs for reliable export
  const imageCache = new Map();

  // ─── DOM Refs (deferred to DOMContentLoaded) ───────────
  let canvasEl, placeholder, propertiesPanel, propsImage, propsText;
  let downloadModal, downloadNameInput;

  // ─── Init ──────────────────────────────────────────────
  function init() {
    canvasEl = document.getElementById('canvas');
    placeholder = document.getElementById('canvas-placeholder');
    propertiesPanel = document.getElementById('properties-panel');
    propsImage = document.getElementById('props-image');
    propsText = document.getElementById('props-text');
    downloadModal = document.getElementById('download-modal');
    downloadNameInput = document.getElementById('download-name-input');

    discoverImages();
    bindTabs();
    bindHeaderButtons();
    bindPropertiesPanel();
    bindCanvasEvents();
    bindKeyboard();
    bindModal();
    bindOverlayControl();
    discoverOverlays();
    fitCanvasToScreen();
    bindPanelGestures();
    checkFirstLoadOverlay();

    window.addEventListener('resize', fitCanvasToScreen);
  }

  function checkFirstLoadOverlay() {
    document.getElementById('jy-overlay-toggle').checked = true;
    const toggle = document.getElementById('jy-overlay-toggle');
    const modal = document.getElementById('overlay-prompt-modal');

    if (choice === 'disabled') {
      if (toggle) toggle.checked = false;
    } else {
      if (toggle) toggle.checked = true;
      // Only show if nothing saved yet
      if (choice === null && modal) {
        modal.classList.remove('hidden');

        document.getElementById('btn-overlay-keep').addEventListener('click', () => {
          if (document.getElementById('remember-overlay-choice').checked) {
            localStorage.setItem('faithCardOverlayChoice', 'enabled');
          }
          modal.classList.add('hidden');
        });

        document.getElementById('btn-overlay-disable').addEventListener('click', () => {
          if (document.getElementById('remember-overlay-choice').checked) {
            localStorage.setItem('faithCardOverlayChoice', 'disabled');
          }
          if (toggle) {
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
          }
          modal.classList.add('hidden');
        });
      }
    }
  }

  function bindPanelGestures() {
    const expandBtn = document.getElementById('btn-expand-panel');
    const panelContent = document.getElementById('panel-content');
    const chevron = document.getElementById('expand-chevron');

    if (expandBtn && panelContent) {
      expandBtn.addEventListener('click', () => {
        panelContent.classList.toggle('expanded');
        if (panelContent.classList.contains('expanded')) {
          chevron.style.transform = 'translateY(-50%) rotate(0deg)';
        } else {
          chevron.style.transform = 'translateY(-50%) rotate(180deg)';
        }
      });
    }

    // Swipe down to close properties panel
    let swipeStartY = 0;
    const propPanel = document.getElementById('properties-panel');
    if (!propPanel) return;
    const header = propPanel.querySelector('.panel-header');
    const handle = propPanel.querySelector('.panel-drag-handle');

    const handleTouchStart = (e) => {
      swipeStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
      const swipeEndY = e.changedTouches[0].clientY;
      // Swiped down sufficiently while not scrolling inner contents?
      // To be safe, any swipe down on header/handle closes it.
      if (swipeEndY - swipeStartY > 40) {
        propPanel.classList.add('hidden');
        const settingsBtn = document.getElementById('btn-element-settings');
        if (settingsBtn) {
          settingsBtn.querySelector('.icon-settings').classList.remove('hidden');
          settingsBtn.querySelector('.icon-close').classList.add('hidden');
        }
      }
    };

    if (header) {
      header.addEventListener('touchstart', handleTouchStart, { passive: true });
      header.addEventListener('touchend', handleTouchEnd);
    }
    if (handle) {
      handle.addEventListener('touchstart', handleTouchStart, { passive: true });
      handle.addEventListener('touchend', handleTouchEnd);
    }
  }

  // ─── Discover images in each category folder ───────────
  async function discoverImages() {
    const categories = Object.keys(IMAGE_LIBRARY);

    await Promise.all(categories.map(async (category) => {
      const grid = document.getElementById(`grid-${category}`);
      let i = 1;
      while (true) {
        const src = `img/${category}/${category}${i}.png`;
        try {
          const res = await fetch(src, { method: 'HEAD' });
          if (!res.ok) break;

          const entry = { src, label: `${category} ${i}` };
          IMAGE_LIBRARY[category].push(entry);
          cacheImage(src);

          // Build thumbnail in the sidebar
          const thumb = document.createElement('div');
          thumb.className = 'image-thumb';
          thumb.title = entry.label;
          thumb.innerHTML = `<img src="${src}" alt="${entry.label}" draggable="false">`;
          thumb.addEventListener('click', (e) => {
            e.preventDefault();
            addImageToCanvas(src, category);
          });
          grid.appendChild(thumb);

          i++;
        } catch (e) {
          break;
        }
      }
    }));
  }

  async function discoverOverlays() {
    const select = document.getElementById('jy-overlay-select');
    if (!select) return;
    select.innerHTML = ''; // Clear default

    let i = 1;
    let foundAny = false;
    while (true) {
      const src = `img/jy-overlay/JY-${i}.png`;
      try {
        const res = await fetch(src, { method: 'HEAD' });
        if (!res.ok) break; // 404 or other error, stop probing

        // Add to dropdown
        const opt = document.createElement('option');
        opt.value = src;
        opt.textContent = `JY-${i}`;
        select.appendChild(opt);

        // Cache it for export
        cacheImage(src);
        foundAny = true;
        i++;
      } catch (e) {
        break;
      }
    }

    if (!foundAny) {
      const opt = document.createElement('option');
      opt.textContent = 'None found';
      opt.disabled = true;
      select.appendChild(opt);
    }

    // Auto-update overlay if it was checked before discovery completes
    const toggle = document.getElementById('jy-overlay-toggle');
    const imgOverlay = document.getElementById('jy-overlay-img');
    if (toggle && toggle.checked && imgOverlay && foundAny) {
      imgOverlay.src = select.value;
    }
  }

  function bindOverlayControl() {
    const toggle = document.getElementById('jy-overlay-toggle');
    const select = document.getElementById('jy-overlay-select');
    const imgOverlay = document.getElementById('jy-overlay-img');

    if (!toggle || !select || !imgOverlay) return;

    toggle.addEventListener('change', (e) => {
      select.disabled = !e.target.checked;
      if (e.target.checked) {
        if (select.value) imgOverlay.src = select.value;
        imgOverlay.classList.remove('hidden');
      } else {
        imgOverlay.classList.add('hidden');
      }
      localStorage.setItem('faithCardOverlayChoice', e.target.checked ? 'enabled' : 'disabled');
    });

    select.addEventListener('change', (e) => {
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
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          imageCache.set(src, { blobUrl, width: img.naturalWidth, height: img.naturalHeight });
        };
        img.src = blobUrl;
      })
      .catch(err => {
        console.warn('Failed to cache image:', src, err);
      });
  }

  // ─── Fit canvas to screen ──────────────────────────────
  function fitCanvasToScreen() {
    const area = document.getElementById('canvas-area');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!area || !wrapper) return;

    const areaRect = area.getBoundingClientRect();
    const padding = 16;
    const availW = areaRect.width - padding * 2;
    const availH = areaRect.height - padding * 2;

    const scale = Math.min(availW / CANVAS_SIZE, availH / CANVAS_SIZE, 1);
    wrapper.style.transform = `scale(${scale})`;
  }

  // ─── Sidebar / Tabs ────────────────────────────────────

  function bindTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        if (!target) return;
        tabs.forEach(t => { if (t.dataset.tab) t.classList.remove('active'); });
        contents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.tab-content[data-content="${target}"]`).classList.add('active');
      });
    });
  }

  // ─── Add Image to Canvas ──────────────────────────────
  function addImageToCanvas(src, category) {
    const cached = imageCache.get(src);
    let naturalW = cached ? cached.width : 500;
    let naturalH = cached ? cached.height : 500;

    let w, h;
    if (category === 'main') {
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
      type: 'image',
      src: src,
      x: category === 'main' ? 0 : Math.round((CANVAS_SIZE - w) / 2),
      y: category === 'main' ? 0 : Math.round((CANVAS_SIZE - h) / 2),
      w: w,
      h: h,
      rotation: 0,
      opacity: 100,
      category: category,
      naturalW: naturalW,
      naturalH: naturalH
    };

    if (category === 'main') {
      elements.unshift(el);
    } else {
      elements.push(el);
    }

    renderCanvas();
    selectElement(el.id);
    placeholder.classList.add('hidden');
  }

  // ─── Add Text ─────────────────────────────────────────
  function addTextToCanvas() {
    const el = {
      id: nextId++,
      type: 'text',
      text: 'Your Text Here',
      x: Math.round(CANVAS_SIZE * 0.25),
      y: Math.round(CANVAS_SIZE * 0.45),
      w: 0,
      h: 0,
      rotation: 0,
      opacity: 100,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: '600',
      color: '#333333'
    };
    elements.push(el);
    renderCanvas();
    selectElement(el.id);
    placeholder.classList.add('hidden');
  }

  // ─── Render Canvas ─────────────────────────────────────
  function renderCanvas() {
    canvasEl.querySelectorAll('.canvas-element').forEach(el => el.remove());

    elements.forEach(el => {
      const div = document.createElement('div');
      div.className = 'canvas-element' + (el.id === selectedId ? ' selected' : '');
      div.dataset.id = el.id;
      div.style.left = el.x + 'px';
      div.style.top = el.y + 'px';
      div.style.transform = `rotate(${el.rotation}deg)`;
      div.style.opacity = el.opacity / 100;

      if (el.type === 'image') {
        div.style.width = el.w + 'px';
        div.style.height = el.h + 'px';
        const img = document.createElement('img');
        img.src = el.src;
        img.draggable = false;
        div.appendChild(img);
      } else if (el.type === 'text') {
        div.classList.add('canvas-text');
        div.style.fontSize = el.fontSize + 'px';
        div.style.fontFamily = `'${el.fontFamily}', sans-serif`;
        div.style.fontWeight = el.fontWeight;
        div.style.color = el.color;
        div.textContent = el.text;
      }

      // Resize handle
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.dataset.resize = el.id;
      div.appendChild(handle);

      // ── Mouse events ──
      div.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.stopPropagation();
        selectElement(el.id);
        startDrag(e.clientX, e.clientY, el.id);
      });

      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectElement(el.id);
        startResize(e.clientX, e.clientY, el.id);
      });

      // ── Touch events ──
      div.addEventListener('touchstart', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.stopPropagation();
        const t = e.touches[0];
        selectElement(el.id);
        startDrag(t.clientX, t.clientY, el.id);
      }, { passive: true });

      handle.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const t = e.touches[0];
        selectElement(el.id);
        startResize(t.clientX, t.clientY, el.id);
      });

      canvasEl.appendChild(div);
    });

    if (elements.length === 0) {
      placeholder.classList.remove('hidden');
    }
  }

  // ─── Selection ─────────────────────────────────────────
  function selectElement(id) {
    if (selectedId === id) return; // Prevent unnecessary class changes
    selectedId = id;

    // Update visual selection borders without destroying the DOM elements
    canvasEl.querySelectorAll('.canvas-element').forEach(elDiv => {
      if (parseInt(elDiv.dataset.id) === id) {
        elDiv.classList.add('selected');
      } else {
        elDiv.classList.remove('selected');
      }
    });

    updatePropertiesPanel();
  }

  function deselectAll() {
    if (selectedId === null) return;
    selectedId = null;

    // Remove visual selection without destroying DOM mapping
    canvasEl.querySelectorAll('.canvas-element').forEach(elDiv => {
      elDiv.classList.remove('selected');
    });

    propertiesPanel.classList.add('hidden');
    const btnSettings = document.getElementById('btn-element-settings');
    if (btnSettings) {
      btnSettings.classList.add('hidden');
      btnSettings.querySelector('.icon-settings').classList.remove('hidden');
      btnSettings.querySelector('.icon-close').classList.add('hidden');
    }
  }

  // ─── Drag Logic (unified mouse + touch) ────────────────
  function startDrag(clientX, clientY, id) {
    const el = elements.find(e => e.id === id);
    if (!el) return;

    const canvasRect = canvasEl.getBoundingClientRect();
    const scale = canvasRect.width / CANVAS_SIZE;

    dragging = {
      id,
      startX: clientX,
      startY: clientY,
      elStartX: el.x,
      elStartY: el.y,
      scale
    };
  }

  function startResize(clientX, clientY, id) {
    const el = elements.find(e => e.id === id);
    if (!el) return;

    resizing = {
      id,
      startX: clientX,
      startY: clientY,
      startW: el.w,
      startH: el.h,
      startFontSize: el.fontSize || 36
    };
  }

  function onPointerMove(clientX, clientY) {
    if (dragging) {
      const el = elements.find(e => e.id === dragging.id);
      if (!el) return;

      const dx = (clientX - dragging.startX) / dragging.scale;
      const dy = (clientY - dragging.startY) / dragging.scale;

      el.x = Math.round(dragging.elStartX + dx);
      el.y = Math.round(dragging.elStartY + dy);

      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) {
        div.style.left = el.x + 'px';
        div.style.top = el.y + 'px';
      }
    }

    if (resizing) {
      const el = elements.find(e => e.id === resizing.id);
      if (!el) return;

      const canvasRect = canvasEl.getBoundingClientRect();
      const scale = canvasRect.width / CANVAS_SIZE;
      const dx = (clientX - resizing.startX) / scale;

      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);

      if (el.type === 'image') {
        const aspectRatio = resizing.startW / resizing.startH;
        let newW = Math.max(30, resizing.startW + dx);
        el.w = Math.round(newW);
        el.h = Math.round(newW / Math.max(0.1, aspectRatio));
        if (div) {
          div.style.width = el.w + 'px';
          div.style.height = el.h + 'px';
        }
      } else if (el.type === 'text') {
        el.fontSize = Math.max(12, Math.min(120, Math.round(resizing.startFontSize + dx * 0.5)));
        if (div) {
          div.style.fontSize = el.fontSize + 'px';
        }
      }

      // Live update properties panel if it's open
      if (selectedId === el.id && !propertiesPanel.classList.contains('hidden')) {
        if (el.type === 'image') {
          const baseSize = el.category === 'main' ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
          const scalePercent = Math.round((el.w / baseSize) * 100);
          setVal('prop-scale', scalePercent);
          setDisplay('prop-scale-val', scalePercent + '%');
        } else {
          setVal('prop-font-size', el.fontSize);
          setDisplay('prop-font-size-val', el.fontSize + 'px');
        }
      }
    }
  }

  function onPointerUp() {
    dragging = null;
    resizing = null;
  }

  // ─── Canvas Events ─────────────────────────────────────
  function bindCanvasEvents() {
    canvasEl.addEventListener('mousedown', (e) => {
      if (e.target === canvasEl || e.target === placeholder || e.target.parentElement === placeholder) {
        deselectAll();
      }
    });

    canvasEl.addEventListener('touchstart', (e) => {
      if (e.target === canvasEl || e.target === placeholder || e.target.parentElement === placeholder) {
        deselectAll();
      }
    }, { passive: true });

    // Mouse move/up
    document.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', onPointerUp);

    // Touch move/end
    document.addEventListener('touchmove', (e) => {
      if (dragging || resizing) {
        e.preventDefault();
        const t = e.touches[0];
        onPointerMove(t.clientX, t.clientY);
      }
    }, { passive: false });

    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('touchcancel', onPointerUp);
  }

  // ─── Keyboard ──────────────────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!selectedId) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const el = elements.find(e => e.id === selectedId);
      if (!el) return;

      const step = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          deleteSelected();
          e.preventDefault();
          break;
        case 'ArrowUp': el.y -= step; renderCanvas(); e.preventDefault(); break;
        case 'ArrowDown': el.y += step; renderCanvas(); e.preventDefault(); break;
        case 'ArrowLeft': el.x -= step; renderCanvas(); e.preventDefault(); break;
        case 'ArrowRight': el.x += step; renderCanvas(); e.preventDefault(); break;
        case 'Escape': deselectAll(); e.preventDefault(); break;
      }
    });
  }

  // ─── Properties Panel ──────────────────────────────────
  function updatePropertiesPanel() {
    const btnSettings = document.getElementById('btn-element-settings');
    const panelTitle = document.getElementById('panel-title');

    if (selectedId === null) {
      propertiesPanel.classList.add('hidden');
      if (btnSettings) {
        btnSettings.classList.add('hidden');
        btnSettings.querySelector('.icon-settings').classList.remove('hidden');
        btnSettings.querySelector('.icon-close').classList.add('hidden');
      }
      return;
    }

    const el = elements.find(e => e.id === selectedId);
    if (!el) {
      propertiesPanel.classList.add('hidden');
      if (btnSettings) {
        btnSettings.classList.add('hidden');
        btnSettings.querySelector('.icon-settings').classList.remove('hidden');
        btnSettings.querySelector('.icon-close').classList.add('hidden');
      }
      return;
    }

    if (btnSettings) {
      btnSettings.classList.remove('hidden');
    }

    if (el.type === 'image') {
      propsImage.classList.remove('hidden');
      propsText.classList.add('hidden');
      document.getElementById('panel-title').textContent = 'Image';

      const baseSize = el.category === 'main' ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
      const scalePercent = Math.round((el.w / baseSize) * 100);

      setVal('prop-scale', scalePercent);
      setDisplay('prop-scale-val', scalePercent + '%');
      setVal('prop-rotation', el.rotation);
      setDisplay('prop-rotation-val', el.rotation + '°');
      setVal('prop-opacity', el.opacity);
      setDisplay('prop-opacity-val', el.opacity + '%');
    } else if (el.type === 'text') {
      propsText.classList.remove('hidden');
      propsImage.classList.add('hidden');
      document.getElementById('panel-title').textContent = 'Text';

      document.getElementById('prop-text-content').value = el.text;
      setVal('prop-font-size', el.fontSize);
      setDisplay('prop-font-size-val', el.fontSize + 'px');
      document.getElementById('prop-font-family').value = el.fontFamily;
      document.getElementById('prop-text-color').value = el.color;
      document.getElementById('prop-font-weight').value = el.fontWeight;
      setVal('prop-text-rotation', el.rotation);
      setDisplay('prop-text-rotation-val', el.rotation + '°');
      setVal('prop-text-opacity', el.opacity);
      setDisplay('prop-text-opacity-val', el.opacity + '%');
    }
  }

  function setVal(id, v) { document.getElementById(id).value = v; }
  function setDisplay(id, v) { document.getElementById(id).textContent = v; }

  function bindPropertiesPanel() {
    // Fading effect when using sliders
    const propPanel = document.getElementById('properties-panel');
    const updateSliderFade = (isSliding, e) => {
      if (!isSliding) {
        propPanel.classList.remove('slider-active');
        propPanel.querySelectorAll('.is-sliding').forEach(el => el.classList.remove('is-sliding'));
        return;
      }
      propPanel.classList.add('slider-active');
      const row = e.target.closest('.prop-row, .prop-row-inline');
      if (row) row.classList.add('is-sliding');
    };

    document.querySelectorAll('#properties-panel input[type="range"]').forEach(slider => {
      slider.addEventListener('mousedown', (e) => updateSliderFade(true, e), { passive: true });
      slider.addEventListener('touchstart', (e) => updateSliderFade(true, e), { passive: true });
    });
    document.addEventListener('mouseup', () => updateSliderFade(false));
    document.addEventListener('touchend', () => updateSliderFade(false));

    // Toggle via close button
    document.getElementById('btn-close-panel').addEventListener('click', () => {
      propertiesPanel.classList.add('hidden');
      const btnSettings = document.getElementById('btn-element-settings');
      if (btnSettings) {
        btnSettings.querySelector('.icon-settings').classList.remove('hidden');
        btnSettings.querySelector('.icon-close').classList.add('hidden');
      }
    });

    // Toggle via floating settings button
    const btnSettings = document.getElementById('btn-element-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        if (propertiesPanel.classList.contains('hidden')) {
          propertiesPanel.classList.remove('hidden');
          btnSettings.querySelector('.icon-settings').classList.add('hidden');
          btnSettings.querySelector('.icon-close').classList.remove('hidden');
        } else {
          propertiesPanel.classList.add('hidden');
          btnSettings.querySelector('.icon-settings').classList.remove('hidden');
          btnSettings.querySelector('.icon-close').classList.add('hidden');
        }
      });
    }

    // Image properties
    bindRange('prop-scale', 'prop-scale-val', '%', (val) => {
      const el = getSelected();
      if (!el || el.type !== 'image') return;
      const aspect = el.naturalW / el.naturalH || 1;
      const baseSize = el.category === 'main' ? CANVAS_SIZE : CANVAS_SIZE * 0.4;
      el.w = Math.round(baseSize * val / 100);
      el.h = Math.round(el.w / aspect);
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) {
        div.style.width = el.w + 'px';
        div.style.height = el.h + 'px';
      }
    });

    bindRange('prop-rotation', 'prop-rotation-val', '°', (val) => {
      const el = getSelected();
      if (!el) return;
      el.rotation = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.transform = `rotate(${el.rotation}deg)`;
    });

    bindRange('prop-opacity', 'prop-opacity-val', '%', (val) => {
      const el = getSelected();
      if (!el) return;
      el.opacity = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.opacity = el.opacity / 100;
    });

    // Text properties
    document.getElementById('prop-text-content').addEventListener('input', (e) => {
      const el = getSelected();
      if (!el || el.type !== 'text') return;
      el.text = e.target.value;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.textContent = el.text;
    });

    bindRange('prop-font-size', 'prop-font-size-val', 'px', (val) => {
      const el = getSelected();
      if (!el || el.type !== 'text') return;
      el.fontSize = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.fontSize = el.fontSize + 'px';
    });

    document.getElementById('prop-font-family').addEventListener('change', (e) => {
      const el = getSelected();
      if (!el || el.type !== 'text') return;
      el.fontFamily = e.target.value;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.fontFamily = `'${el.fontFamily}', sans-serif`;
    });

    document.getElementById('prop-text-color').addEventListener('input', (e) => {
      const el = getSelected();
      if (!el || el.type !== 'text') return;
      el.color = e.target.value;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.color = el.color;
    });

    document.getElementById('prop-font-weight').addEventListener('change', (e) => {
      const el = getSelected();
      if (!el || el.type !== 'text') return;
      el.fontWeight = e.target.value;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.fontWeight = el.fontWeight;
    });

    bindRange('prop-text-rotation', 'prop-text-rotation-val', '°', (val) => {
      const el = getSelected();
      if (!el) return;
      el.rotation = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.transform = `rotate(${el.rotation}deg)`;
    });

    bindRange('prop-text-opacity', 'prop-text-opacity-val', '%', (val) => {
      const el = getSelected();
      if (!el) return;
      el.opacity = val;
      const div = document.querySelector(`.canvas-element[data-id="${el.id}"]`);
      if (div) div.style.opacity = el.opacity / 100;
    });

    // Layer actions
    document.getElementById('btn-bring-front').addEventListener('click', () => {
      if (!selectedId) return;
      const idx = elements.findIndex(e => e.id === selectedId);
      if (idx < elements.length - 1) {
        const el = elements.splice(idx, 1)[0];
        elements.push(el);
        renderCanvas();
      }
    });

    document.getElementById('btn-send-back').addEventListener('click', () => {
      if (!selectedId) return;
      const idx = elements.findIndex(e => e.id === selectedId);
      if (idx > 0) {
        const el = elements.splice(idx, 1)[0];
        elements.unshift(el);
        renderCanvas();
      }
    });

    document.getElementById('btn-delete-el').addEventListener('click', deleteSelected);
  }

  function bindRange(inputId, valId, suffix, callback) {
    const input = document.getElementById(inputId);
    const valSpan = document.getElementById(valId);
    input.addEventListener('input', () => {
      const val = parseInt(input.value);
      valSpan.textContent = val + suffix;
      callback(val);
    });
  }

  // ─── Header Buttons ───────────────────────────────────
  function bindHeaderButtons() {
    document.getElementById('btn-add-text').addEventListener('click', addTextToCanvas);

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (elements.length === 0) return;
      if (confirm('Clear all elements from the canvas?')) {
        elements = [];
        selectedId = null;
        nextId = 1;
        renderCanvas();
        propertiesPanel.classList.add('hidden');
      }
    });

    document.getElementById('btn-download').addEventListener('click', showDownloadModal);
  }

  // ─── Download Modal ────────────────────────────────────
  function bindModal() {
    document.getElementById('btn-modal-cancel').addEventListener('click', hideDownloadModal);
    document.getElementById('btn-modal-save').addEventListener('click', executeDownload);

    // Press Enter to save
    downloadNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeDownload();
      }
      if (e.key === 'Escape') {
        hideDownloadModal();
      }
    });

    // Click overlay to close
    downloadModal.addEventListener('click', (e) => {
      if (e.target === downloadModal) {
        hideDownloadModal();
      }
    });
  }

  function showDownloadModal() {
    deselectAll();
    downloadNameInput.value = '';
    downloadModal.classList.remove('hidden');
    // Focus input after animation
    setTimeout(() => downloadNameInput.focus(), 250);
  }

  function hideDownloadModal() {
    downloadModal.classList.add('hidden');
  }

  function executeDownload() {
    const nameVal = downloadNameInput.value.trim();
    const filename = nameVal ? `${nameVal}-card.png` : 'card.png';
    hideDownloadModal();
    downloadPNG(filename);
  }

  // ─── Export to PNG (fixed: uses cached data URLs) ──────
  function downloadPNG(filename) {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_SIZE;
    offscreen.height = CANVAS_SIZE;
    const ctx = offscreen.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Load all image elements using cached blob URLs
    const loadPromises = elements.map(el => {
      if (el.type === 'image') {
        return new Promise((resolve) => {
          const cached = imageCache.get(el.src);
          if (!cached) {
            // Fallback: fetch the image fresh as a blob
            fetch(el.src)
              .then(r => r.blob())
              .then(blob => {
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
            console.warn('Failed to load for export:', el.src);
            resolve({ el, img: null });
          };
          img.src = cached.blobUrl;
        });
      } else {
        return Promise.resolve({ el, img: null });
      }
    });

    const overlayToggle = document.getElementById('jy-overlay-toggle');
    const overlaySelect = document.getElementById('jy-overlay-select');
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

    Promise.all(loadPromises).then(results => {
      results.forEach((res) => {
        if (res.isOverlay) return;
        const { el, img } = res;
        ctx.save();
        ctx.globalAlpha = el.opacity / 100;

        if (el.type === 'image' && img) {
          if (el.rotation !== 0) {
            const cx = el.x + el.w / 2;
            const cy = el.y + el.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate((el.rotation * Math.PI) / 180);
            ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
          } else {
            ctx.drawImage(img, el.x, el.y, el.w, el.h);
          }
        } else if (el.type === 'text') {
          ctx.font = `${el.fontWeight} ${el.fontSize}px '${el.fontFamily}', sans-serif`;
          ctx.fillStyle = el.color;
          ctx.textBaseline = 'top';

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
      const overlayRes = results.find(r => r.isOverlay);
      if (overlayRes && overlayRes.img) {
        ctx.globalAlpha = 1; // force 100% opacity for top overlay
        ctx.drawImage(overlayRes.img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }

      // Trigger download
      offscreen.toBlob((blob) => {
        if (!blob) {
          alert('Failed to generate image. Please try again.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    });
  }

  // ─── Helpers ───────────────────────────────────────────
  function getSelected() {
    return elements.find(e => e.id === selectedId) || null;
  }

  function deleteSelected() {
    if (!selectedId) return;
    elements = elements.filter(e => e.id !== selectedId);
    selectedId = null;
    renderCanvas();
    propertiesPanel.classList.add('hidden');
  }

  // ─── Kick Off ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
