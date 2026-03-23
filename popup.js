const DIM_OPACITY_KEY = "ds-sideview-dim-opacity";
const DIM_DURATION_KEY = "ds-sideview-dim-duration";
const DIM_MODE_KEY = "ds-sideview-dim-mode";
const DIM_MODE_MASK = "mask";
const DIM_MODE_TEXT = "text";

document.addEventListener("DOMContentLoaded", () => {
  const slider = document.getElementById("dim-slider");
  const display = document.getElementById("dim-percent-display");
  
  const durationSlider = document.getElementById("dim-duration-slider");
  const durationDisplay = document.getElementById("dim-duration-display");
  const modeOptions = document.querySelectorAll("[data-dim-mode]");

  // 加载当前保存的设置状态
  chrome.storage.local.get([DIM_OPACITY_KEY, DIM_DURATION_KEY, DIM_MODE_KEY], (result) => {
    let opacity = 0; // 默认透明度 0%
    if (result[DIM_OPACITY_KEY] !== undefined) {
      opacity = result[DIM_OPACITY_KEY];
    }
    slider.value = opacity;
    display.textContent = opacity + "%";
    
    let duration = 20; // 默认过渡时间 2.0s（滑块中存储为 20）
    if (result[DIM_DURATION_KEY] !== undefined) {
      duration = result[DIM_DURATION_KEY];
    }
    durationSlider.value = duration;
    durationDisplay.textContent = (duration / 10).toFixed(1) + "s";

    const mode = result[DIM_MODE_KEY] === DIM_MODE_MASK ? DIM_MODE_MASK : DIM_MODE_TEXT;
    updateModeOptions(modeOptions, mode);
  });

  modeOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const mode = option.dataset.dimMode === DIM_MODE_TEXT ? DIM_MODE_TEXT : DIM_MODE_MASK;
      updateModeOptions(modeOptions, mode);
      chrome.storage.local.set({ [DIM_MODE_KEY]: mode });
    });
  });

  // 拖拽透明度滑块时实时更新显示
  slider.addEventListener("input", (e) => {
    const value = e.target.value;
    display.textContent = value + "%";
    
    // 发送消息到当前活动标签页以进行实时预览
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          type: "ds-dim-preview", 
          value: parseInt(value, 10) 
        }).catch(() => {});
      }
    });
  });

  // 松开透明度滑块后保存设置
  slider.addEventListener("change", (e) => {
    chrome.storage.local.set({ [DIM_OPACITY_KEY]: parseInt(e.target.value, 10) });
  });

  // 拖拽过渡时间滑块时实时更新显示
  durationSlider.addEventListener("input", (e) => {
    const value = parseInt(e.target.value, 10);
    durationDisplay.textContent = (value / 10).toFixed(1) + "s";
    
    // 发送消息到当前活动标签页以进行实时预览
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          type: "ds-dim-duration-preview", 
          value: value 
        }).catch(() => {});
      }
    });
  });

  // 松开过渡时间滑块后保存设置
  durationSlider.addEventListener("change", (e) => {
    chrome.storage.local.set({ [DIM_DURATION_KEY]: parseInt(e.target.value, 10) });
  });
});

function updateModeOptions(modeOptions, activeMode) {
  modeOptions.forEach((option) => {
    const isActive = option.dataset.dimMode === activeMode;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-pressed", String(isActive));
  });
}
