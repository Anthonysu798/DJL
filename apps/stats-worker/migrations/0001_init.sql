CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT,
  version TEXT
);
CREATE INDEX downloads_ts ON downloads (ts);

CREATE TABLE installs (
  install_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  channel TEXT,
  country TEXT
);
CREATE INDEX installs_first_seen ON installs (first_seen);
