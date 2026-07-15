function TopBar({ title }) {
  return (
    <div className="topbar">
      <div>
        <div className="page-title">{title}</div>
        <div className="page-sub">Full period · Jan 2025 – Jul 2026 · All products</div>
      </div>
      <div className="badge">
        <span className="blink-dot"></span>Live Data
      </div>
    </div>
  );
}

export default TopBar;