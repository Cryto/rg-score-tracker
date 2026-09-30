-- Seeds the versions table. Run once, in the Supabase SQL Editor.
--
-- Mapping verified against RemyWiki (cross-checked debut version for 5 songs
-- spanning the range: GRADIUSIC CYBER=1st style, THE EARTH LIGHT=substream,
-- .59=2nd style, ABSOLUTE=4th style, THE CANNONBALLER=25 CANNON BALLERS,
-- Shooting Star=33 Sparkle Shower). iidx-db's "folder" column maps as:
--   folder 0  -> 1st style
--   folder 1  -> substream (no official number; given `number = 0` here,
--                only for a stable foreign key, not implying chronology)
--   folder 2-33 -> matches the official version number directly
--   anything else (e.g. 80) is not a real version folder; left unmapped.
insert into versions (number, name, release_year) values
  (0, 'substream', 1999),
  (1, '1st style', 1999),
  (2, '2nd style', 1999),
  (3, '3rd style', 2000),
  (4, '4th style', 2000),
  (5, '5th style', 2001),
  (6, '6th style', 2001),
  (7, '7th style', 2002),
  (8, '8th style', 2002),
  (9, '9th style', 2003),
  (10, '10th style', 2004),
  (11, '11 IIDX RED', 2004),
  (12, '12 HAPPY SKY', 2005),
  (13, '13 DistorteD', 2006),
  (14, '14 GOLD', 2007),
  (15, '15 DJ TROOPERS', 2007),
  (16, '16 EMPRESS', 2008),
  (17, '17 SIRIUS', 2009),
  (18, '18 Resort Anthem', 2010),
  (19, '19 Lincle', 2011),
  (20, '20 tricoro', 2012),
  (21, '21 SPADA', 2013),
  (22, '22 PENDUAL', 2014),
  (23, '23 copula', 2015),
  (24, '24 SINOBUZ', 2016),
  (25, '25 CANNON BALLERS', 2017),
  (26, '26 Rootage', 2018),
  (27, '27 HEROIC VERSE', 2019),
  (28, '28 BISTROVER', 2020),
  (29, '29 CastHour', 2021),
  (30, '30 RESIDENT', 2022),
  (31, '31 EPOLIS', 2023),
  (32, '32 Pinky Crush', 2024),
  (33, '33 Sparkle Shower', 2025)
on conflict (number) do nothing;
