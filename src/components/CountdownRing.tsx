/**
 * Watch-face countdown ring — the Wonderland pocket-watch motif. A gold ring
 * depletes clockwise around a circular "dial", driven by an Animated 0..1
 * value (1 = full ring).
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

// Animated 会给被包裹组件强制注入 collapsable（防原生 View 扁平化），
// react-native-svg 的 web 实现会把它透传到 DOM，触发 React 的
// "non-boolean attribute" 报错（software-mansion/react-native-svg#1484）。
// 这里包一层把它过滤掉（对原生端无影响）。
const CircleNoCollapsable = forwardRef<
  React.ComponentRef<typeof Circle>,
  React.ComponentProps<typeof Circle> & { collapsable?: boolean }
>(function CircleNoCollapsable({ collapsable, ...rest }, ref) {
  return <Circle ref={ref} {...rest} />;
});

const AnimatedCircle = Animated.createAnimatedComponent(CircleNoCollapsable);

interface CountdownRingProps {
  size: number;
  strokeWidth: number;
  /** Remaining fraction, 0..1 (1 = full ring). */
  progress: Animated.Value | Animated.AnimatedInterpolation<number>;
  color: string;
  trackColor: string;
  /** Number of watch-dial tick marks (0 to disable). */
  ticks?: number;
  tickColor?: string;
  children?: ReactNode;
}

export function CountdownRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
  ticks = 0,
  tickColor,
  children,
}: CountdownRingProps) {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const tickMarks = [];
  if (ticks > 0 && tickColor) {
    const outer = radius - strokeWidth / 2 - 4;
    const inner = outer - 6;
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * 2 * Math.PI - Math.PI / 2;
      tickMarks.push(
        <Line
          key={i}
          x1={center + inner * Math.cos(angle)}
          y1={center + inner * Math.sin(angle)}
          x2={center + outer * Math.cos(angle)}
          y2={center + outer * Math.sin(angle)}
          stroke={tickColor}
          strokeWidth={i % 3 === 0 ? 2 : 1}
          strokeLinecap="round"
        />,
      );
    }
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {tickMarks}
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={progress.interpolate({
            inputRange: [0, 1],
            outputRange: [circumference, 0],
          })}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {children}
    </View>
  );
}
