CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  path TEXT NOT NULL,
  country TEXT
);
CREATE INDEX visits_ts ON visits (ts);
CREATE INDEX visits_visitor_id ON visits (visitor_id);
