from pathlib import Path
import sqlite3


db_path = Path('/opt/apollo-rag/shared/weknora/data/weknora.db')
init_path = Path('/opt/apollo-rag/weknora/migrations/sqlite/000000_init.up.sql')
db_path.parent.mkdir(parents=True, exist_ok=True)

with sqlite3.connect(db_path) as db:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'tenants' not in tables:
        db.executescript(init_path.read_text())

    def columns(table: str) -> set[str]:
        return {row[1] for row in db.execute(f'PRAGMA table_info({table})')}

    patches = {
        'users': [('is_system_admin', 'BOOLEAN NOT NULL DEFAULT 0')],
        'knowledges': [('pending_subtasks_count', 'INTEGER NOT NULL DEFAULT 0')],
        'knowledge_bases': [('wiki_config', 'TEXT'), ('indexing_strategy', 'TEXT')],
    }
    for table, additions in patches.items():
        existing = columns(table)
        for name, definition in additions:
            if name not in existing:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')

    db.executescript('''
        CREATE INDEX IF NOT EXISTS idx_users_is_system_admin ON users(is_system_admin);
        CREATE TABLE IF NOT EXISTS knowledge_tags (
            id VARCHAR(36) PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            knowledge_base_id VARCHAR(36) NOT NULL,
            name VARCHAR(128) NOT NULL,
            color VARCHAR(32),
            sort_order INTEGER NOT NULL DEFAULT 0,
            seq_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_tags_kb_name ON knowledge_tags(tenant_id, knowledge_base_id, name);
        CREATE INDEX IF NOT EXISTS idx_knowledge_tags_kb ON knowledge_tags(tenant_id, knowledge_base_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_tags_seq_id ON knowledge_tags(seq_id);
        CREATE TABLE IF NOT EXISTS knowledge_tag_relations (
            knowledge_id VARCHAR(36) NOT NULL,
            tag_id VARCHAR(36) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (knowledge_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ktr_knowledge ON knowledge_tag_relations(knowledge_id);
        CREATE INDEX IF NOT EXISTS idx_ktr_tag ON knowledge_tag_relations(tag_id);
        CREATE TABLE IF NOT EXISTS system_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key VARCHAR(128) NOT NULL UNIQUE,
            value TEXT NOT NULL,
            value_type VARCHAR(16) NOT NULL,
            category VARCHAR(32) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            is_secret BOOLEAN NOT NULL DEFAULT 0,
            requires_restart BOOLEAN NOT NULL DEFAULT 0,
            last_modified_by VARCHAR(36) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
    ''')
