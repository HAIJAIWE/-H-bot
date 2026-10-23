// src/renderer/src/components/canvas/NewbieGuide.tsx
// 新手引导层：首次进画布显示「拖这里→连那里」动画手势
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { t } from '../../i18n';
import { STORAGE_KEYS } from '../../lib/infra/storageKeys';

const GUIDE_KEY = STORAGE_KEYS.canvasGuideCompleted;
const GUIDE_STEPS = [
  {
    id: 'welcome',
    get title() {
      return t('canvas.guide.welcome.title');
    },
    get content() {
      return t('canvas.guide.welcome.content');
    },
    target: null,
    action: 'next',
  },
  {
    id: 'palette',
    get title() {
      return t('canvas.guide.palette.title');
    },
    get content() {
      return t('canvas.guide.palette.content');
    },
    target: '.node-palette',
    action: 'drag',
    animation: 'drag-left-to-canvas',
  },
  {
    id: 'connect',
    get title() {
      return t('canvas.guide.connect.title');
    },
    get content() {
      return t('canvas.guide.connect.content');
    },
    target: '.react-flow__node',
    action: 'connect',
    animation: 'connect-right-to-left',
  },
  {
    id: 'config',
    get title() {
      return t('canvas.guide.config.title');
    },
    get content() {
      return t('canvas.guide.config.content');
    },
    target: '.react-flow__node.selected',
    action: 'click',
    animation: 'click-node',
  },
  {
    id: 'test',
    get title() {
      return t('canvas.guide.test.title');
    },
    get content() {
      return t('canvas.guide.test.content');
    },
    target: '[data-guide-target="test"]',
    action: 'click',
    animation: 'click-test',
  },
  {
    id: 'generate',
    get title() {
      return t('canvas.guide.generate.title');
    },
    // 原文写的是"输出 TypeScript 文件，扫码推送到机器人即可上线" —— 那是**假承诺**：
    // 快照不参与编译、运行时不加载它（解释器直接读 .qqbat/flow.json），上线也不需要它。
    // 按"文案说真话"改掉。
    get content() {
      return t('canvas.guide.generate.contentPrefix') + t('canvas.guide.generate.contentSuffix');
    },
    target: '[data-guide-target="generate"]',
    action: 'click',
    animation: 'click-generate',
  },
  {
    id: 'done',
    get title() {
      return t('canvas.guide.done.title');
    },
    get content() {
      return t('canvas.guide.done.content');
    },
    target: null,
    action: 'complete',
  },
];

function getStepElement(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  try {
    // 一律走 CSS 选择器。**不要**再用「按按钮文字匹配」那一套：
    // 按钮文字会随界面语言变（「测试」→「Test」），拿中文文案当选择器等于
    // 把引导的定位绑死在中文界面上。改用不随语言变的 [data-guide-target="…"]。
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export function NewbieGuide() {
  // GUIDE_STEPS 的文案是模块级 getter，组件体内看不到 t()，所以这条订阅必须手写：
  // 少了它，切语言时引导面板不会重渲染，还停在旧语言。
  useLocaleSubscription();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [highlightEl, setHighlightEl] = useState<HTMLElement | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const completed = localStorage.getItem(GUIDE_KEY) === 'true';
  const nodes = useFlowStore((s) => s.nodes);
  const projectName = useProjectStore((s) => s.currentProject?.name);

  useEffect(() => {
    if (!completed && projectName && nodes.length === 0) {
      // 首次进入空项目时自动开始引导
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [completed, projectName, nodes.length]);

  useEffect(() => {
    if (!isVisible) {
      setHighlightEl(null);
      return;
    }
    const step = GUIDE_STEPS[currentStep];
    const el = getStepElement(step.target);
    setHighlightEl(el);
  }, [isVisible, currentStep]);

  const handleNext = () => {
    if (currentStep < GUIDE_STEPS.length - 1) {
      setCurrentStep((c) => c + 1);
    } else {
      localStorage.setItem(GUIDE_KEY, 'true');
      setIsVisible(false);
      setCurrentStep(0);
    }
  };

  const handleSkip = () => {
    localStorage.setItem(GUIDE_KEY, 'true');
    setIsVisible(false);
    setCurrentStep(0);
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((c) => c - 1);
  };

  if (!isVisible) return null;

  const step = GUIDE_STEPS[currentStep];
  const progress = ((currentStep + 1) / GUIDE_STEPS.length) * 100;

  return createPortal(
    <>
      {/* 全屏遮罩 + 高亮孔 */}
      <div
        className="fixed inset-0 z-[10000] pointer-events-none"
        style={{
          background: 'rgba(0, 0, 0, 0.6)',
          clipPath: highlightEl
            ? `polygon(
                  0 0, 100% 0, 100% 100%, 0 100%,
                  ${highlightEl.getBoundingClientRect().left - 8}px ${highlightEl.getBoundingClientRect().top - 8}px,
                  ${highlightEl.getBoundingClientRect().right + 8}px ${highlightEl.getBoundingClientRect().top - 8}px,
                  ${highlightEl.getBoundingClientRect().right + 8}px ${highlightEl.getBoundingClientRect().bottom + 8}px,
                  ${highlightEl.getBoundingClientRect().left - 8}px ${highlightEl.getBoundingClientRect().bottom + 8}px
                )`
            : 'none',
        }}
      />
      {/* 进度条 */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10001] w-64 h-1.5 bg-zinc-800 rounded-full overflow-hidden pointer-events-none">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* 步骤卡片 */}
      <div
        ref={stepRef}
        className="fixed z-[10001] w-80 max-w-[90vw] bg-zinc-900/95 border border-zinc-700 rounded-xl shadow-2xl p-4 pointer-events-auto animate-slide-in"
        style={{
          top: highlightEl ? `${highlightEl.getBoundingClientRect().bottom + 16}px` : '50%',
          left: highlightEl ? `${highlightEl.getBoundingClientRect().left}px` : '50%',
          transform: highlightEl ? 'none' : 'translate(-50%, -50%)',
          maxWidth: '90vw',
        }}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{step.title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-3">{step.content}</p>
          </div>
          <button
            onClick={handleSkip}
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-colors"
            title={t('canvas.guide.skip')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-1 mb-3">
          {GUIDE_STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentStep ? 'bg-blue-500 w-6' : 'bg-zinc-600 hover:bg-zinc-500'
              }`}
            />
          ))}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
          <span className="text-[10px] text-zinc-500">
            {currentStep + 1} / {GUIDE_STEPS.length}
          </span>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {t('canvas.guide.prev')}
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all"
            >
              {currentStep === GUIDE_STEPS.length - 1
                ? t('settings.diagnosticsDialog.phaseDone')
                : t('canvas.guide.next')}
              <ArrowRight className="w-3 h-3 ml-1 inline" />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// 样式注入（只需注入一次）。`.newbie-highlight` 是高亮元素的脉冲动画。
if (typeof window !== 'undefined') {
  const styleId = 'newbie-guide-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes slide-in {
        from { opacity: 0; transform: translateY(-10px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .animate-slide-in { animation: slide-in 0.3s ease-out; }
      .newbie-highlight {
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.3) !important;
        animation: pulse-ring 1.5s ease-out infinite !important;
        z-index: 9999 !important;
      }
      @keyframes pulse-ring {
        0% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5); }
        50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.2); }
        100% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default NewbieGuide;
