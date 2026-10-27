DELETE FROM system_features WHERE code = 'ldap';
DROP INDEX uq_users_ldap_dn;
ALTER TABLE users DROP CONSTRAINT chk_users_ldap_dn, DROP COLUMN ldap_dn, DROP COLUMN auth_source;
DROP TABLE ldap_config;
