-- Entrar con la cuenta del dominio (pendiente 10k, spec/20; decisiones del
-- dueño 2026-10-26). El directorio solo valida la contraseña: rol, áreas,
-- nivel y grupos siguen siendo de la Bitácora y LDAP nunca los escribe.
-- Va detrás de system_features.ldap.
--
-- Conexión: siempre con TLS (ldaps:// o StartTLS). La contraseña de la cuenta
-- de servicio va cifrada (crypto.Box) y nunca se devuelve. {usuario} en el
-- filtro se reemplaza por lo que se tipeó, escapado (RFC 4515). group_dn:
-- solo entran por LDAP los miembros directos de ese grupo (vacío = todos).
CREATE TABLE ldap_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  url TEXT NOT NULL DEFAULT '',
  start_tls BOOLEAN NOT NULL DEFAULT false,
  verify_tls BOOLEAN NOT NULL DEFAULT true,
  ca_pem TEXT NOT NULL DEFAULT '',
  bind_dn TEXT NOT NULL DEFAULT '',
  bind_password_encrypted TEXT,
  base_dn TEXT NOT NULL DEFAULT '',
  user_filter TEXT NOT NULL DEFAULT '(sAMAccountName={usuario})',
  username_attr TEXT NOT NULL DEFAULT 'sAMAccountName',
  name_attr TEXT NOT NULL DEFAULT 'displayName',
  email_attr TEXT NOT NULL DEFAULT 'mail',
  group_dn TEXT NOT NULL DEFAULT '',
  timeout_seconds INT NOT NULL DEFAULT 8 CHECK (timeout_seconds BETWEEN 2 AND 60),
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ldap_config DEFAULT VALUES;

-- De dónde sale la contraseña de cada cuenta:
--   auto  = si la persona está en el directorio, vale la del dominio (y la
--           cuenta pasa a ldap la primera vez que entra); si no, la local.
--   ldap  = ya se vinculó (ldap_dn): solo vale la del dominio.
--   local = solo la de la Bitácora, nunca se vincula (el admin de emergencia).
-- El admin del setup y el de .env nacen local.
ALTER TABLE users
  ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'auto' CHECK (auth_source IN ('auto', 'ldap', 'local')),
  ADD COLUMN ldap_dn TEXT,
  ADD CONSTRAINT chk_users_ldap_dn CHECK ((auth_source = 'ldap') = (ldap_dn IS NOT NULL));
CREATE UNIQUE INDEX uq_users_ldap_dn ON users(lower(ldap_dn)) WHERE ldap_dn IS NOT NULL;

INSERT INTO system_features (code, name, description) VALUES
  ('ldap', 'Entrar con la cuenta del dominio', 'Valida la contraseña contra el LDAP / Active Directory (Administración → LDAP). Las áreas se siguen manejando en la Bitácora.')
ON CONFLICT (code) DO NOTHING;
