import { useRef, useEffect } from 'react';
import Chart from 'chart.js/auto';

function ChartCard({ title, subtitle, tag, chartConfig, height = '240px' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && chartConfig) {
      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = new Chart(canvasRef.current, chartConfig);
    }
    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [chartConfig]);

  return (
    <div className="chart-card">
      {(title || subtitle || tag) && (
        <div className="chart-header">
          <div>
            {title && <div className="chart-title">{title}</div>}
            {subtitle && <div className="chart-sub">{subtitle}</div>}
          </div>
          {tag && <div className="chart-tag">{tag}</div>}
        </div>
      )}
      <div className="chart-wrap" style={{ height }}>
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
}

export default ChartCard;