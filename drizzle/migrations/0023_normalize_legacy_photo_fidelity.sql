-- Migration 0022 changed the database default to high, but its SQLite table
-- rebuild retained the prior off value for existing scenes. Align those legacy
-- rows with the new default so they use source photos unless explicitly reset.
UPDATE `scenes` SET `photo_fidelity` = 'high' WHERE `photo_fidelity` = 'off';
