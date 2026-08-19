function TopBar({ title, dateRange }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="page-title">{title}</div>
        <div className="page-sub">
          <span className="breadcrumb-sep">Full period</span>
          <span className="breadcrumb-dot">·</span>
          <span>{dateRange}</span>
          <span className="breadcrumb-dot">·</span>
          <span>All products</span>
        </div>
      </div>

      <div className="topbar-right">
        <div className="topbar-time">{timeStr}</div>
        <div className="badge live-badge">
          <span className="blink-dot"></span>
          Live
        </div>
      </div>
    </div>
  );
}

export default TopBar;
