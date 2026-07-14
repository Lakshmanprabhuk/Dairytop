function KpiCard({ color, icon, label, value, change, valueClass = '' }) {
  return (
    <div className={`kpi-card ${color}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{value}</div>
      <div className="kpi-change">{change}</div>
    </div>
  );
}

export default KpiCard;