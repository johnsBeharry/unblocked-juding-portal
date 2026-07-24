-- Demo data for local development only:
--   npx wrangler d1 execute unblocked-judging --local --file scripts/seed-demo.sql
INSERT INTO contests (slug, name, theme, description, status) VALUES
  ('ownership-2026', 'Ownership 2026', 'Ownership',
   'Poster contest exploring what it means to own — land, identity, data, and memory.',
   'round1');

INSERT INTO submissions (contest_id, public_id, title, artist_name, artist_email, country, concept) VALUES
  (1, 'OWN-001', 'The Locked Garden', 'Elena Moretti', 'elena@example.com', 'Italy', 'A private garden is drawn as a public promise sealed behind a lock. The poster questions whether beauty can be owned when the community is kept outside its walls.'),
  (1, 'OWN-002', 'Terms & Conditions', 'Jonas Weber', 'jonas@example.com', 'Germany', 'A receipt-like composition turns platform language into a visual contract. The work asks how much we really own when every file, profile, and memory depends on permission.'),
  (1, 'OWN-003', 'Borrowed Identity', 'Maya Okonkwo', 'maya@example.com', 'Nigeria', 'The face is split by data marks and a surveillance eye. It frames identity as something both deeply personal and constantly extracted by systems we do not control.'),
  (1, 'OWN-004', 'Keys Without Doors', 'Nora El-Amin', 'nora@example.com', 'Egypt', 'A chain of oversized keys points toward no entrance. The poster explores symbolic possession: having access tokens, passwords, and proof without real agency.'),
  (1, 'OWN-005', 'The Receipt', 'Theo Grant', 'theo@example.com', 'United Kingdom', 'A stamped circle floats over a receipt that cannot name what was bought. It studies ownership as paperwork, proof, and the fragile rituals around value.'),
  (1, 'OWN-006', 'Not Yours Anymore', 'Clara Park', 'clara@example.com', 'South Korea', 'Streaming bars and a red cancel mark turn entertainment into disappearance. The work critiques subscription culture and the quiet replacement of ownership with temporary access.'),
  (1, 'OWN-007', 'Inheritance Loop', 'Sofia Alvarez', 'sofia@example.com', 'Mexico', 'The poster uses circular family-map forms to ask what can be inherited: land, language, debt, memory, or obligation. Ownership becomes a loop rather than a transaction.'),
  (1, 'OWN-008', 'Seed Phrase', 'Mila Novak', 'mila@example.com', 'Serbia', 'Fragmented words form a private key around a sealed circle. The poster treats self-custody as both liberation and burden: if you own it, you must protect it.'),
  (1, 'OWN-009', 'Museum of Deleted Things', 'Ari Chen', 'ari@example.com', 'Canada', 'Stacked white blocks become an archive with missing labels. The poster asks who owns digital memory when platforms can erase, compress, or rename the past.'),
  (1, 'OWN-010', 'Landline', 'Leah Mensah', 'leah@example.com', 'Ghana', 'A map-grid and dashed circle collide to question land, borders, and belonging. The work presents ownership as a political line drawn over lived relationships.');
