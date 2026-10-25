"use client";

// 通用 hover 形态切换工具条。
// 🔴 接合点契约：
//   HoverFormatToolbar(props: { options: Array<{ key: string; label: string; icon: React.ReactNode }>;
//     value: string; onChange: (key: string) => void; visible: boolean; className?: string }) → JSX.Element
//   只画一排按钮·当前 value 高亮·点 option 调 onChange(key)·visible=false 延宽限期后隐藏·
//   绝对定位由调用方父容器管（本组件不自带 position 假设·className 由调用方注入 absolute 等）。
//
// hover 断层修——经典 hover-gap 三件套内建于此·消费方零改动即得：
//   ① 宽限延时：visible 变 false 不立刻卸载·延 HIDE_GRACE_MS 再隐；期间 visible 回 true 或鼠标进工具条即取消（计时器进清出建）。
//   ② 工具条自身 hover 保持显示：外层容器挂 mouseenter/mouseleave 记 selfHover·hover 中永不隐。
//   ③ 悬停桥：外层容器带 pb-1——工具条与目标间的视觉空隙由容器 padding 承担（属 hover 判定区）·
//      配合消费方 bottom-full 紧贴定位（别再用 -top-8 悬空留缝）·鼠标穿行全程不出判定区。
import { useEffect, useRef, useState, type ReactNode } from 'react';

// mouseleave 后到真隐藏的宽限（ms）·盖住「链接→工具条」斜穿/抖动路径
const HIDE_GRACE_MS = 280;

export interface HoverFormatToolbarOption {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface HoverFormatToolbarProps {
  options: HoverFormatToolbarOption[];
  value: string;
  onChange: (key: string) => void;
  visible: boolean;
  className?: string;
}

export function HoverFormatToolbar({ options, value, onChange, visible, className }: HoverFormatToolbarProps) {
  // selfHover=鼠标正压在工具条自己身上（含 pb-1 桥区）·与调用方的 visible 求或
  const [selfHover, setSelfHover] = useState(false);
  const [shown, setShown] = useState(visible);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible || selfHover) {
      // 要显：清掉在途隐藏计时器·立刻显（宽限期内回流=取消隐藏）
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setShown(true);
      return;
    }
    // 要隐：不立刻卸·延宽限期（deps 再变时 cleanup 清计时器=进出清建）
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setShown(false);
      // DOM 即将卸载·mouseleave 不会再来·同步复位防 stale selfHover=true 卡常显
      setSelfHover(false);
    }, HIDE_GRACE_MS);
    return () => {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    };
  }, [visible, selfHover]);

  if (!shown) return null;
  return (
    <div
      // pb-1=悬停桥：工具条与目标间 4px 视觉空隙划进本容器 padding（hover 判定区内）·
      // 消费方用 bottom-full 把本容器底边贴在目标顶边=全程无缝
      className={`pb-1 ${className ?? ''}`}
      onMouseEnter={() => setSelfHover(true)}
      onMouseLeave={() => setSelfHover(false)}
      // 编辑器内工具条·按下别抢编辑器焦点/选区（onMouseDown preventDefault）
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg dark:border-gray-600 dark:bg-gray-800">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            title={o.label}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs whitespace-nowrap transition-colors ${
              value === o.key
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default HoverFormatToolbar;
