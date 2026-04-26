// WZ-2008 (Klassifikation der Wirtschaftszweige, Statistisches Bundesamt 2008)
// Kuratierte Liste auf Abteilungs- (2-stellig) und Klassen-Ebene (4-stellig).
// Volle Liste hat ~615 Klassen, das wäre für eine Combobox ohne Backend-Suche
// zu viel; wir liefern die 88 Abteilungen plus die wichtigsten B2B-relevanten
// Klassen — User können „Sonstiges" wählen, wenn nichts passt.
//
// Quelle: Destatis WZ 2008. Codes und Bezeichnungen sind die offiziellen.
// "Sonstiges" wurde als kanonischer Eintrag „99.99" festgelegt (nicht in
// WZ enthalten — bewusst gewählt, damit es kollisionsfrei bleibt).

export type WzSection = {
  code: string;       // A..U
  label: string;      // Sektionstitel
};

export type WzCode = {
  code: string;       // "62" oder "62.01" oder "99.99"
  label: string;      // Bezeichnung
  section: string;    // A..U
};

export const WZ_SECTIONS: WzSection[] = [
  { code: "A", label: "Land- und Forstwirtschaft, Fischerei" },
  { code: "B", label: "Bergbau und Gewinnung von Steinen und Erden" },
  { code: "C", label: "Verarbeitendes Gewerbe" },
  { code: "D", label: "Energieversorgung" },
  { code: "E", label: "Wasserversorgung; Abwasser- und Abfallentsorgung" },
  { code: "F", label: "Baugewerbe" },
  { code: "G", label: "Handel; Instandhaltung und Reparatur von Kraftfahrzeugen" },
  { code: "H", label: "Verkehr und Lagerei" },
  { code: "I", label: "Gastgewerbe" },
  { code: "J", label: "Information und Kommunikation" },
  { code: "K", label: "Erbringung von Finanz- und Versicherungsdienstleistungen" },
  { code: "L", label: "Grundstücks- und Wohnungswesen" },
  { code: "M", label: "Erbringung von freiberuflichen, wissenschaftlichen und technischen Dienstleistungen" },
  { code: "N", label: "Erbringung von sonstigen wirtschaftlichen Dienstleistungen" },
  { code: "O", label: "Öffentliche Verwaltung, Verteidigung; Sozialversicherung" },
  { code: "P", label: "Erziehung und Unterricht" },
  { code: "Q", label: "Gesundheits- und Sozialwesen" },
  { code: "R", label: "Kunst, Unterhaltung und Erholung" },
  { code: "S", label: "Erbringung von sonstigen Dienstleistungen" },
  { code: "T", label: "Private Haushalte" },
  { code: "U", label: "Exterritoriale Organisationen" },
];

// Kanonischer Code für „Sonstiges". Steht außerhalb der WZ und wird damit
// nie versehentlich von einer Heuristik mit einer realen Branche kollidieren.
export const WZ_OTHER_CODE = "99.99";

// Kuratierte Liste: alle 88 Abteilungen + breite Auswahl an Klassen, die
// in B2B-Sales typisch vorkommen (IT, Beratung, Maschinenbau, Logistik,
// Pharma, Chemie, Energie, Finanz, Real Estate, Health, Retail, …).
export const WZ_CODES: WzCode[] = [
  // A — Land- und Forstwirtschaft, Fischerei
  { code: "01", label: "Landwirtschaft, Jagd und damit verbundene Tätigkeiten", section: "A" },
  { code: "01.11", label: "Anbau von Getreide (ohne Reis), Hülsenfrüchten und Ölsaaten", section: "A" },
  { code: "01.41", label: "Haltung von Milchkühen", section: "A" },
  { code: "01.50", label: "Gemischte Landwirtschaft", section: "A" },
  { code: "01.61", label: "Erbringung von landwirtschaftlichen Dienstleistungen für die pflanzliche Erzeugung", section: "A" },
  { code: "02", label: "Forstwirtschaft und Holzeinschlag", section: "A" },
  { code: "02.10", label: "Forstwirtschaft", section: "A" },
  { code: "02.20", label: "Holzeinschlag", section: "A" },
  { code: "03", label: "Fischerei und Aquakultur", section: "A" },

  // B — Bergbau
  { code: "05", label: "Kohlenbergbau", section: "B" },
  { code: "06", label: "Gewinnung von Erdöl und Erdgas", section: "B" },
  { code: "07", label: "Erzbergbau", section: "B" },
  { code: "08", label: "Gewinnung von Steinen und Erden, sonstiger Bergbau", section: "B" },
  { code: "09", label: "Erbringung von Dienstleistungen für den Bergbau", section: "B" },

  // C — Verarbeitendes Gewerbe (Abteilungen 10-33)
  { code: "10", label: "Herstellung von Nahrungs- und Futtermitteln", section: "C" },
  { code: "10.11", label: "Schlachten (ohne Schlachten von Geflügel)", section: "C" },
  { code: "10.51", label: "Milchverarbeitung (ohne Herstellung von Speiseeis)", section: "C" },
  { code: "10.71", label: "Herstellung von Backwaren (ohne Dauerbackwaren)", section: "C" },
  { code: "10.91", label: "Herstellung von Futtermitteln für Nutztiere", section: "C" },
  { code: "11", label: "Getränkeherstellung", section: "C" },
  { code: "11.05", label: "Herstellung von Bier", section: "C" },
  { code: "11.07", label: "Herstellung von Erfrischungsgetränken; Gewinnung natürlicher Mineralwässer", section: "C" },
  { code: "12", label: "Tabakverarbeitung", section: "C" },
  { code: "13", label: "Herstellung von Textilien", section: "C" },
  { code: "13.20", label: "Weberei", section: "C" },
  { code: "13.92", label: "Herstellung von konfektionierten Textilwaren (ohne Bekleidung)", section: "C" },
  { code: "14", label: "Herstellung von Bekleidung", section: "C" },
  { code: "14.13", label: "Herstellung von sonstiger Oberbekleidung", section: "C" },
  { code: "15", label: "Herstellung von Leder, Lederwaren und Schuhen", section: "C" },
  { code: "15.20", label: "Herstellung von Schuhen", section: "C" },
  { code: "16", label: "Herstellung von Holz-, Flecht-, Korb- und Korkwaren (ohne Möbel)", section: "C" },
  { code: "16.10", label: "Säge-, Hobel- und Holzimprägnierwerke", section: "C" },
  { code: "16.23", label: "Herstellung von sonstigen Konstruktionsteilen, Fertigbauteilen, Ausbauelementen aus Holz", section: "C" },
  { code: "17", label: "Herstellung von Papier, Pappe und Waren daraus", section: "C" },
  { code: "17.12", label: "Herstellung von Papier, Karton und Pappe", section: "C" },
  { code: "17.21", label: "Herstellung von Wellpapier und -pappe sowie Verpackungsmitteln aus Papier, Karton und Pappe", section: "C" },
  { code: "18", label: "Herstellung von Druckerzeugnissen; Vervielfältigung", section: "C" },
  { code: "18.12", label: "Drucken a.n.g.", section: "C" },
  { code: "18.20", label: "Vervielfältigung von bespielten Ton-, Bild- und Datenträgern", section: "C" },
  { code: "19", label: "Kokerei und Mineralölverarbeitung", section: "C" },
  { code: "19.20", label: "Mineralölverarbeitung", section: "C" },
  { code: "20", label: "Herstellung von chemischen Erzeugnissen", section: "C" },
  { code: "20.13", label: "Herstellung von sonstigen anorganischen Grundstoffen und Chemikalien", section: "C" },
  { code: "20.30", label: "Herstellung von Anstrichmitteln, Druckfarben und Kitten", section: "C" },
  { code: "20.59", label: "Herstellung von sonstigen chemischen Erzeugnissen a.n.g.", section: "C" },
  { code: "21", label: "Herstellung von pharmazeutischen Erzeugnissen", section: "C" },
  { code: "21.10", label: "Herstellung von pharmazeutischen Grundstoffen", section: "C" },
  { code: "21.20", label: "Herstellung von pharmazeutischen Spezialitäten und sonstigen pharmazeutischen Erzeugnissen", section: "C" },
  { code: "22", label: "Herstellung von Gummi- und Kunststoffwaren", section: "C" },
  { code: "22.11", label: "Herstellung und Runderneuerung von Bereifungen", section: "C" },
  { code: "22.21", label: "Herstellung von Platten, Folien, Schläuchen und Profilen aus Kunststoffen", section: "C" },
  { code: "22.22", label: "Herstellung von Verpackungsmitteln aus Kunststoffen", section: "C" },
  { code: "22.29", label: "Herstellung von sonstigen Kunststoffwaren", section: "C" },
  { code: "23", label: "Herstellung von Glas und Glaswaren, Keramik, Verarbeitung von Steinen und Erden", section: "C" },
  { code: "23.11", label: "Herstellung von Flachglas", section: "C" },
  { code: "23.51", label: "Herstellung von Zement", section: "C" },
  { code: "23.61", label: "Herstellung von Erzeugnissen aus Beton, Zement und Kalksandstein für den Bau", section: "C" },
  { code: "23.70", label: "Be- und Verarbeitung von Naturwerksteinen und Natursteinen a.n.g.", section: "C" },
  { code: "24", label: "Metallerzeugung und -bearbeitung", section: "C" },
  { code: "24.10", label: "Erzeugung von Roheisen, Stahl und Ferrolegierungen", section: "C" },
  { code: "24.20", label: "Herstellung von Stahlrohren, Rohrform-, Rohrverschluss- und Rohrverbindungsstücken aus Stahl", section: "C" },
  { code: "24.42", label: "Erzeugung und erste Bearbeitung von Aluminium", section: "C" },
  { code: "24.51", label: "Eisengießereien", section: "C" },
  { code: "25", label: "Herstellung von Metallerzeugnissen", section: "C" },
  { code: "25.11", label: "Herstellung von Metallkonstruktionen", section: "C" },
  { code: "25.21", label: "Herstellung von Heizkörpern und -kesseln für Zentralheizungen", section: "C" },
  { code: "25.50", label: "Herstellung von Schmiede-, Press-, Zieh- und Stanzteilen, gewalzten Ringen und pulvermetallurgischen Erzeugnissen", section: "C" },
  { code: "25.61", label: "Oberflächenveredlung und Wärmebehandlung", section: "C" },
  { code: "25.62", label: "Mechanik a.n.g.", section: "C" },
  { code: "25.99", label: "Herstellung von sonstigen Metallwaren a.n.g.", section: "C" },
  { code: "26", label: "Herstellung von Datenverarbeitungsgeräten, elektronischen und optischen Erzeugnissen", section: "C" },
  { code: "26.20", label: "Herstellung von Datenverarbeitungsgeräten und peripheren Geräten", section: "C" },
  { code: "26.30", label: "Herstellung von Geräten und Einrichtungen der Telekommunikationstechnik", section: "C" },
  { code: "26.51", label: "Herstellung von Mess-, Kontroll-, Navigations- u. ä. Instrumenten und Vorrichtungen", section: "C" },
  { code: "26.70", label: "Herstellung von optischen und fotografischen Instrumenten und Geräten", section: "C" },
  { code: "27", label: "Herstellung von elektrischen Ausrüstungen", section: "C" },
  { code: "27.11", label: "Herstellung von Elektromotoren, Generatoren und Transformatoren", section: "C" },
  { code: "27.12", label: "Herstellung von Elektrizitätsverteilungs- und -schalteinrichtungen", section: "C" },
  { code: "27.20", label: "Herstellung von Batterien und Akkumulatoren", section: "C" },
  { code: "27.32", label: "Herstellung von sonstigen elektronischen und elektrischen Drähten und Kabeln", section: "C" },
  { code: "27.51", label: "Herstellung von Elektrohaushaltsgeräten", section: "C" },
  { code: "28", label: "Maschinenbau", section: "C" },
  { code: "28.11", label: "Herstellung von Verbrennungsmotoren und Turbinen (ohne Motoren für Luft- und Straßenfahrzeuge)", section: "C" },
  { code: "28.21", label: "Herstellung von Öfen und Brennern", section: "C" },
  { code: "28.22", label: "Herstellung von Hebezeugen und Fördermitteln", section: "C" },
  { code: "28.29", label: "Herstellung von sonstigen nicht wirtschaftszweigspezifischen Maschinen a.n.g.", section: "C" },
  { code: "28.41", label: "Herstellung von Werkzeugmaschinen für die Metallbearbeitung", section: "C" },
  { code: "28.99", label: "Herstellung von Maschinen für sonstige bestimmte Wirtschaftszweige a.n.g.", section: "C" },
  { code: "29", label: "Herstellung von Kraftwagen und Kraftwagenteilen", section: "C" },
  { code: "29.10", label: "Herstellung von Kraftwagen und Kraftwagenmotoren", section: "C" },
  { code: "29.32", label: "Herstellung von sonstigen Teilen und sonstigem Zubehör für Kraftwagen", section: "C" },
  { code: "30", label: "Sonstiger Fahrzeugbau", section: "C" },
  { code: "30.11", label: "Schiffbau (ohne Boots- und Yachtbau)", section: "C" },
  { code: "30.20", label: "Schienenfahrzeugbau", section: "C" },
  { code: "30.30", label: "Luft- und Raumfahrzeugbau", section: "C" },
  { code: "31", label: "Herstellung von Möbeln", section: "C" },
  { code: "31.01", label: "Herstellung von Büro- und Ladenmöbeln", section: "C" },
  { code: "31.09", label: "Herstellung von sonstigen Möbeln", section: "C" },
  { code: "32", label: "Herstellung von sonstigen Waren", section: "C" },
  { code: "32.50", label: "Herstellung von medizinischen und zahnmedizinischen Apparaten und Materialien", section: "C" },
  { code: "32.99", label: "Herstellung von sonstigen Erzeugnissen a.n.g.", section: "C" },
  { code: "33", label: "Reparatur und Installation von Maschinen und Ausrüstungen", section: "C" },
  { code: "33.12", label: "Reparatur von Maschinen", section: "C" },
  { code: "33.20", label: "Installation von Maschinen und Ausrüstungen a.n.g.", section: "C" },

  // D — Energieversorgung
  { code: "35", label: "Energieversorgung", section: "D" },
  { code: "35.11", label: "Elektrizitätserzeugung", section: "D" },
  { code: "35.12", label: "Elektrizitätsübertragung", section: "D" },
  { code: "35.13", label: "Elektrizitätsverteilung", section: "D" },
  { code: "35.14", label: "Handel mit Elektrizität", section: "D" },
  { code: "35.21", label: "Gaserzeugung", section: "D" },
  { code: "35.22", label: "Gasverteilung durch Rohrleitungen", section: "D" },
  { code: "35.30", label: "Wärme- und Kälteversorgung", section: "D" },

  // E — Wasser/Abfall
  { code: "36", label: "Wasserversorgung", section: "E" },
  { code: "37", label: "Abwasserentsorgung", section: "E" },
  { code: "38", label: "Sammlung, Behandlung und Beseitigung von Abfällen; Rückgewinnung", section: "E" },
  { code: "38.11", label: "Sammlung nicht gefährlicher Abfälle", section: "E" },
  { code: "38.21", label: "Behandlung und Beseitigung nicht gefährlicher Abfälle", section: "E" },
  { code: "38.32", label: "Rückgewinnung sortierter Werkstoffe", section: "E" },
  { code: "39", label: "Beseitigung von Umweltverschmutzungen und sonstige Entsorgung", section: "E" },

  // F — Baugewerbe
  { code: "41", label: "Hochbau", section: "F" },
  { code: "41.10", label: "Erschließung von Grundstücken; Bauträger", section: "F" },
  { code: "41.20", label: "Bau von Gebäuden", section: "F" },
  { code: "42", label: "Tiefbau", section: "F" },
  { code: "42.11", label: "Bau von Straßen", section: "F" },
  { code: "42.12", label: "Bahnverkehrsbau", section: "F" },
  { code: "42.21", label: "Leitungstiefbau für Versorgungsnetze", section: "F" },
  { code: "42.99", label: "Bau von sonstigen Anlagen für den Tiefbau a.n.g.", section: "F" },
  { code: "43", label: "Vorbereitende Baustellenarbeiten, Bauinstallation und sonstiges Ausbaugewerbe", section: "F" },
  { code: "43.21", label: "Elektroinstallation", section: "F" },
  { code: "43.22", label: "Gas-, Wasser-, Heizungs- sowie Lüftungs- und Klimainstallation", section: "F" },
  { code: "43.31", label: "Anbringen von Stuckaturen, Gipserei und Verputzerei", section: "F" },
  { code: "43.32", label: "Bautischlerei und -schlosserei", section: "F" },
  { code: "43.91", label: "Dachdeckerei und Bauspenglerei", section: "F" },
  { code: "43.99", label: "Sonstige Spezialbautätigkeiten a.n.g.", section: "F" },

  // G — Handel
  { code: "45", label: "Handel mit Kraftfahrzeugen; Instandhaltung und Reparatur von Kraftfahrzeugen", section: "G" },
  { code: "45.11", label: "Handel mit Kraftwagen mit einem Gesamtgewicht von 3,5 t oder weniger", section: "G" },
  { code: "45.20", label: "Instandhaltung und Reparatur von Kraftwagen", section: "G" },
  { code: "45.32", label: "Einzelhandel mit Kraftwagenteilen und -zubehör", section: "G" },
  { code: "46", label: "Großhandel (ohne Handel mit Kraftfahrzeugen)", section: "G" },
  { code: "46.21", label: "Großhandel mit Getreide, Rohtabak, Saatgut und Futtermitteln", section: "G" },
  { code: "46.31", label: "Großhandel mit Obst, Gemüse und Kartoffeln", section: "G" },
  { code: "46.46", label: "Großhandel mit pharmazeutischen Erzeugnissen", section: "G" },
  { code: "46.51", label: "Großhandel mit Datenverarbeitungsgeräten, peripheren Geräten und Software", section: "G" },
  { code: "46.69", label: "Großhandel mit sonstigen Maschinen und Ausrüstungen a.n.g.", section: "G" },
  { code: "46.71", label: "Großhandel mit festen, flüssigen und gasförmigen Brennstoffen sowie damit verwandten Erzeugnissen", section: "G" },
  { code: "46.73", label: "Großhandel mit Holz, Baustoffen, Anstrichmitteln und Sanitärkeramik", section: "G" },
  { code: "46.90", label: "Großhandel ohne ausgeprägten Schwerpunkt", section: "G" },
  { code: "47", label: "Einzelhandel (ohne Handel mit Kraftfahrzeugen)", section: "G" },
  { code: "47.11", label: "Einzelhandel mit Waren verschiedener Art, Hauptrichtung Nahrungs- und Genussmittel, Getränke und Tabakwaren", section: "G" },
  { code: "47.30", label: "Einzelhandel mit Motorenkraftstoffen (Tankstellen)", section: "G" },
  { code: "47.43", label: "Einzelhandel mit Geräten der Unterhaltungselektronik", section: "G" },
  { code: "47.71", label: "Einzelhandel mit Bekleidung", section: "G" },
  { code: "47.91", label: "Versand- und Internet-Einzelhandel", section: "G" },

  // H — Verkehr und Lagerei
  { code: "49", label: "Landverkehr und Transport in Rohrfernleitungen", section: "H" },
  { code: "49.10", label: "Personenbeförderung im Eisenbahnfernverkehr", section: "H" },
  { code: "49.20", label: "Güterbeförderung im Eisenbahnverkehr", section: "H" },
  { code: "49.31", label: "Personenbeförderung im Nahverkehr zu Lande (ohne Taxen)", section: "H" },
  { code: "49.41", label: "Güterbeförderung im Straßenverkehr", section: "H" },
  { code: "49.42", label: "Umzugstransporte", section: "H" },
  { code: "50", label: "Schifffahrt", section: "H" },
  { code: "50.20", label: "Güterbeförderung in der See- und Küstenschifffahrt", section: "H" },
  { code: "51", label: "Luftfahrt", section: "H" },
  { code: "51.10", label: "Personenbeförderung in der Luftfahrt", section: "H" },
  { code: "51.21", label: "Güterbeförderung in der Luftfahrt", section: "H" },
  { code: "52", label: "Lagerei sowie Erbringung von sonstigen Dienstleistungen für den Verkehr", section: "H" },
  { code: "52.10", label: "Lagerei", section: "H" },
  { code: "52.21", label: "Erbringung von sonstigen Dienstleistungen für den Landverkehr", section: "H" },
  { code: "52.24", label: "Frachtumschlag", section: "H" },
  { code: "52.29", label: "Erbringung von sonstigen Dienstleistungen für den Verkehr", section: "H" },
  { code: "53", label: "Post-, Kurier- und Expressdienste", section: "H" },
  { code: "53.10", label: "Postdienste von Universaldienstleistungsanbietern", section: "H" },
  { code: "53.20", label: "Sonstige Post-, Kurier- und Expressdienste", section: "H" },

  // I — Gastgewerbe
  { code: "55", label: "Beherbergung", section: "I" },
  { code: "55.10", label: "Hotels, Gasthöfe und Pensionen", section: "I" },
  { code: "55.20", label: "Ferienunterkünfte und ähnliche Beherbergungsstätten", section: "I" },
  { code: "55.30", label: "Campingplätze", section: "I" },
  { code: "56", label: "Gastronomie", section: "I" },
  { code: "56.10", label: "Restaurants, Gaststätten, Imbissstuben, Cafés, Eissalons u. Ä.", section: "I" },
  { code: "56.21", label: "Caterer", section: "I" },
  { code: "56.30", label: "Ausschank von Getränken", section: "I" },

  // J — Information und Kommunikation
  { code: "58", label: "Verlagswesen", section: "J" },
  { code: "58.11", label: "Verlegen von Büchern", section: "J" },
  { code: "58.13", label: "Verlegen von Zeitungen", section: "J" },
  { code: "58.14", label: "Verlegen von Zeitschriften", section: "J" },
  { code: "58.21", label: "Verlegen von Computerspielen", section: "J" },
  { code: "58.29", label: "Verlegen von sonstiger Software", section: "J" },
  { code: "59", label: "Herstellung, Verleih und Vertrieb von Filmen und Fernsehprogrammen; Tonstudios und Verlegen von Musik", section: "J" },
  { code: "59.11", label: "Herstellung von Filmen, Videofilmen und Fernsehprogrammen", section: "J" },
  { code: "59.20", label: "Tonstudios; Herstellung von Hörfunkbeiträgen; Verlegen von bespielten Tonträgern und Musikalien", section: "J" },
  { code: "60", label: "Rundfunkveranstalter", section: "J" },
  { code: "60.10", label: "Hörfunkveranstalter", section: "J" },
  { code: "60.20", label: "Fernsehveranstalter", section: "J" },
  { code: "61", label: "Telekommunikation", section: "J" },
  { code: "61.10", label: "Leitungsgebundene Telekommunikation", section: "J" },
  { code: "61.20", label: "Drahtlose Telekommunikation", section: "J" },
  { code: "61.30", label: "Satellitentelekommunikation", section: "J" },
  { code: "61.90", label: "Sonstige Telekommunikation", section: "J" },
  { code: "62", label: "Erbringung von Dienstleistungen der Informationstechnologie", section: "J" },
  { code: "62.01", label: "Programmierungstätigkeiten (Software-Entwicklung)", section: "J" },
  { code: "62.02", label: "Erbringung von Beratungsleistungen auf dem Gebiet der Informationstechnologie", section: "J" },
  { code: "62.03", label: "Betrieb von Datenverarbeitungseinrichtungen für Dritte", section: "J" },
  { code: "62.09", label: "Erbringung von sonstigen Dienstleistungen der Informationstechnologie", section: "J" },
  { code: "63", label: "Informationsdienstleistungen", section: "J" },
  { code: "63.11", label: "Datenverarbeitung, Hosting und damit verbundene Tätigkeiten", section: "J" },
  { code: "63.12", label: "Webportale", section: "J" },
  { code: "63.91", label: "Korrespondenz- und Nachrichtenbüros", section: "J" },
  { code: "63.99", label: "Erbringung von sonstigen Informationsdienstleistungen a.n.g.", section: "J" },

  // K — Finanz- und Versicherungsdienstleistungen
  { code: "64", label: "Erbringung von Finanzdienstleistungen", section: "K" },
  { code: "64.11", label: "Zentralbanken", section: "K" },
  { code: "64.19", label: "Kreditinstitute (ohne Spezialkreditinstitute)", section: "K" },
  { code: "64.20", label: "Beteiligungsgesellschaften", section: "K" },
  { code: "64.30", label: "Treuhand- und sonstige Fonds und ähnliche Finanzinstitutionen", section: "K" },
  { code: "64.91", label: "Institutionen für Finanzierungsleasing", section: "K" },
  { code: "64.92", label: "Sonstige Kreditinstitute", section: "K" },
  { code: "65", label: "Versicherungen, Rückversicherungen und Pensionskassen (ohne Sozialversicherung)", section: "K" },
  { code: "65.11", label: "Lebensversicherungen", section: "K" },
  { code: "65.12", label: "Nichtlebensversicherungen", section: "K" },
  { code: "65.20", label: "Rückversicherungen", section: "K" },
  { code: "65.30", label: "Pensionskassen, Pensionsfonds und ähnliche Einrichtungen der Altersversorgung", section: "K" },
  { code: "66", label: "Mit Finanz- und Versicherungsdienstleistungen verbundene Tätigkeiten", section: "K" },
  { code: "66.12", label: "Effekten- und Warenterminbörsen, Wertpapier- und Warenterminhandel", section: "K" },
  { code: "66.19", label: "Sonstige mit Finanzdienstleistungen verbundene Tätigkeiten", section: "K" },
  { code: "66.22", label: "Tätigkeit von Versicherungsmaklern und -agenturen", section: "K" },

  // L — Grundstücks- und Wohnungswesen
  { code: "68", label: "Grundstücks- und Wohnungswesen", section: "L" },
  { code: "68.10", label: "Kauf und Verkauf von eigenen Grundstücken, Gebäuden und Wohnungen", section: "L" },
  { code: "68.20", label: "Vermietung, Verpachtung von eigenen oder geleasten Grundstücken, Gebäuden und Wohnungen", section: "L" },
  { code: "68.31", label: "Vermittlung von Grundstücken, Gebäuden und Wohnungen", section: "L" },
  { code: "68.32", label: "Verwaltung von Grundstücken, Gebäuden und Wohnungen für Dritte", section: "L" },

  // M — Freiberufliche, wiss., techn. Dienstleistungen
  { code: "69", label: "Rechts- und Steuerberatung, Wirtschaftsprüfung", section: "M" },
  { code: "69.10", label: "Rechtsberatung", section: "M" },
  { code: "69.20", label: "Wirtschaftsprüfung und Steuerberatung", section: "M" },
  { code: "70", label: "Verwaltung und Führung von Unternehmen und Betrieben; Unternehmensberatung", section: "M" },
  { code: "70.10", label: "Verwaltung und Führung von Unternehmen und Betrieben", section: "M" },
  { code: "70.21", label: "Public-Relations- und Kommunikationsberatung", section: "M" },
  { code: "70.22", label: "Unternehmensberatung", section: "M" },
  { code: "71", label: "Architektur- und Ingenieurbüros; technische, physikalische und chemische Untersuchung", section: "M" },
  { code: "71.11", label: "Architekturbüros", section: "M" },
  { code: "71.12", label: "Ingenieurbüros", section: "M" },
  { code: "71.20", label: "Technische, physikalische und chemische Untersuchung", section: "M" },
  { code: "72", label: "Forschung und Entwicklung", section: "M" },
  { code: "72.11", label: "Forschung und Entwicklung im Bereich Biotechnologie", section: "M" },
  { code: "72.19", label: "Sonstige Forschung und Entwicklung im Bereich Natur-, Ingenieur-, Agrarwissenschaften und Medizin", section: "M" },
  { code: "72.20", label: "Forschung und Entwicklung im Bereich Rechts-, Wirtschafts- und Sozialwissenschaften sowie im Bereich Sprach-, Kultur- und Kunstwissenschaften", section: "M" },
  { code: "73", label: "Werbung und Marktforschung", section: "M" },
  { code: "73.11", label: "Werbeagenturen", section: "M" },
  { code: "73.12", label: "Vermarktung und Vermittlung von Werbezeiten und Werbeflächen", section: "M" },
  { code: "73.20", label: "Markt- und Meinungsforschung", section: "M" },
  { code: "74", label: "Sonstige freiberufliche, wissenschaftliche und technische Tätigkeiten", section: "M" },
  { code: "74.10", label: "Ateliers für Textil-, Schmuck-, Grafik- u. Ä. Design", section: "M" },
  { code: "74.20", label: "Fotografie und Fotolabors", section: "M" },
  { code: "74.30", label: "Übersetzen und Dolmetschen", section: "M" },
  { code: "74.90", label: "Sonstige freiberufliche, wissenschaftliche und technische Tätigkeiten a.n.g.", section: "M" },
  { code: "75", label: "Veterinärwesen", section: "M" },

  // N — Sonstige wirtschaftliche Dienstleistungen
  { code: "77", label: "Vermietung von beweglichen Sachen", section: "N" },
  { code: "77.11", label: "Vermietung von Kraftwagen mit einem Gesamtgewicht von 3,5 t oder weniger", section: "N" },
  { code: "77.32", label: "Vermietung von Baumaschinen und -geräten", section: "N" },
  { code: "77.40", label: "Leasing von nichtfinanziellen immateriellen Vermögensgegenständen (ohne Copyrights)", section: "N" },
  { code: "78", label: "Vermittlung und Überlassung von Arbeitskräften", section: "N" },
  { code: "78.10", label: "Vermittlung von Arbeitskräften", section: "N" },
  { code: "78.20", label: "Befristete Überlassung von Arbeitskräften", section: "N" },
  { code: "79", label: "Reisebüros, Reiseveranstalter und sonstige Reservierungsdienstleistungen", section: "N" },
  { code: "79.11", label: "Reisebüros", section: "N" },
  { code: "79.12", label: "Reiseveranstalter", section: "N" },
  { code: "80", label: "Wach- und Sicherheitsdienste sowie Detekteien", section: "N" },
  { code: "80.10", label: "Private Wach- und Sicherheitsdienste", section: "N" },
  { code: "80.20", label: "Sicherheitsdienste mithilfe von Überwachungs- und Alarmsystemen", section: "N" },
  { code: "81", label: "Gebäudebetreuung; Garten- und Landschaftsbau", section: "N" },
  { code: "81.10", label: "Hausmeisterdienste", section: "N" },
  { code: "81.21", label: "Allgemeine Gebäudereinigung", section: "N" },
  { code: "81.30", label: "Garten- und Landschaftsbau sowie Erbringung von sonstigen gärtnerischen Dienstleistungen", section: "N" },
  { code: "82", label: "Erbringung von wirtschaftlichen Dienstleistungen für Unternehmen und Privatpersonen a.n.g.", section: "N" },
  { code: "82.11", label: "Erbringung von kombinierten Sekretariatsdienstleistungen", section: "N" },
  { code: "82.20", label: "Call Center", section: "N" },
  { code: "82.30", label: "Messe-, Ausstellungs- und Kongressveranstalter", section: "N" },
  { code: "82.92", label: "Abfüllen und Verpacken a.n.g.", section: "N" },
  { code: "82.99", label: "Erbringung von sonstigen wirtschaftlichen Dienstleistungen für Unternehmen und Privatpersonen a.n.g.", section: "N" },

  // O — Öffentliche Verwaltung
  { code: "84", label: "Öffentliche Verwaltung, Verteidigung; Sozialversicherung", section: "O" },

  // P — Erziehung und Unterricht
  { code: "85", label: "Erziehung und Unterricht", section: "P" },

  // Q — Gesundheit / Soziales
  { code: "86", label: "Gesundheitswesen", section: "Q" },
  { code: "86.10", label: "Krankenhäuser", section: "Q" },
  { code: "86.21", label: "Arztpraxen für Allgemeinmedizin", section: "Q" },
  { code: "86.22", label: "Facharztpraxen", section: "Q" },
  { code: "86.23", label: "Zahnarztpraxen", section: "Q" },
  { code: "86.90", label: "Gesundheitswesen a.n.g.", section: "Q" },
  { code: "87", label: "Heime (ohne Erholungs- und Ferienheime)", section: "Q" },
  { code: "87.10", label: "Pflegeheime", section: "Q" },
  { code: "87.30", label: "Altenheime; Alten- und Behindertenwohnheime", section: "Q" },
  { code: "88", label: "Sozialwesen (ohne Heime)", section: "Q" },
  { code: "88.10", label: "Soziale Betreuung älterer Menschen und Behinderter", section: "Q" },
  { code: "88.91", label: "Tagesbetreuung von Kindern", section: "Q" },

  // R — Kunst, Unterhaltung, Erholung
  { code: "90", label: "Kreative, künstlerische und unterhaltende Tätigkeiten", section: "R" },
  { code: "91", label: "Bibliotheken, Archive, Museen, botanische und zoologische Gärten", section: "R" },
  { code: "92", label: "Spiel-, Wett- und Lotteriewesen", section: "R" },
  { code: "93", label: "Erbringung von Dienstleistungen des Sports, der Unterhaltung und der Erholung", section: "R" },

  // S — Sonstige Dienstleistungen
  { code: "94", label: "Interessenvertretungen sowie kirchliche und sonstige religiöse Vereinigungen (ohne Sozialwesen und Sport)", section: "S" },
  { code: "95", label: "Reparatur von Datenverarbeitungsgeräten und Gebrauchsgütern", section: "S" },
  { code: "96", label: "Erbringung von sonstigen überwiegend persönlichen Dienstleistungen", section: "S" },

  // T / U — Selten relevant für B2B, aber Vollständigkeit
  { code: "97", label: "Private Haushalte mit Hauspersonal", section: "T" },
  { code: "98", label: "Herstellung von Waren und Erbringung von Dienstleistungen durch private Haushalte für den Eigenbedarf ohne ausgeprägten Schwerpunkt", section: "T" },
  { code: "99", label: "Exterritoriale Organisationen und Körperschaften", section: "U" },

  // Sonstiges — kanonischer Eintrag, nie aus echter WZ-Liste übernommen.
  { code: WZ_OTHER_CODE, label: "Sonstiges / nicht zugeordnet", section: "S" },
];

const WZ_BY_CODE = new Map<string, WzCode>(WZ_CODES.map((c) => [c.code, c]));

export function isValidWzCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return WZ_BY_CODE.has(code);
}

export function getWzCode(code: string | null | undefined): WzCode | null {
  if (!code) return null;
  return WZ_BY_CODE.get(code) ?? null;
}

export function getWzLabel(code: string | null | undefined): string | null {
  return getWzCode(code)?.label ?? null;
}

// ── Heuristische Zuordnung freier Branchentexte → WZ-Code ──
//
// Nur einsetzen für (a) Migration alter Freitext-Werte und (b) Vorschlag
// aus Web-Anreicherung. Für die normale Eingabe nimmt der User die Auswahl.
// Konservativ: lieber `WZ_OTHER_CODE` als ein falsch geratener Code.

type Heuristic = { keywords: RegExp; code: string };

// Reihenfolge zählt: spezifische Treffer zuerst, generische zuletzt.
const HEURISTICS: Heuristic[] = [
  { keywords: /\bsaa?s\b|software\s+as\s+a\s+service/i, code: "62.01" },
  { keywords: /\bcloud\b.*\b(provider|services?|platform)\b|\bplatform\s+as\s+a\s+service|paa?s\b/i, code: "63.11" },
  { keywords: /\bsoftware\s*(entwicklung|engineering|development|haus)\b|\bsoftwarehersteller\b|\bprogrammier/i, code: "62.01" },
  { keywords: /\b(it|edv)[\s-]+(beratung|consult|service|dienstleist)/i, code: "62.02" },
  { keywords: /\b(rechen|daten)zentrum\b|\bdata\s*center\b|\bhosting\b|\bcolocation\b/i, code: "63.11" },
  { keywords: /\b(it|edv|informationstechnik|information\s+technology)\b/i, code: "62" },
  { keywords: /\btelekommunikation\b|\btelco\b|\btelekom\b|telecommunications?/i, code: "61" },
  { keywords: /\b(verlag|publishing|publisher)\b/i, code: "58" },
  { keywords: /\b(media|medien|marketing)agentur|werbeagentur|advertising\s+agency/i, code: "73.11" },
  { keywords: /\bmarktforschung|market\s+research/i, code: "73.20" },
  { keywords: /\bunternehmens?beratung|management\s+consult|strategieberatung/i, code: "70.22" },
  { keywords: /\b(steuerberater|wirtschaftspr[uü]fer|auditor|tax\s+advisor)/i, code: "69.20" },
  { keywords: /\b(rechtsanwalt|kanzlei|law\s+firm|legal\s+services?)/i, code: "69.10" },
  { keywords: /\barchitekt(ur|en)/i, code: "71.11" },
  { keywords: /\bingenieur(b[uü]ro|gesellschaft|wesen)|\bengineering\b/i, code: "71.12" },
  { keywords: /\bforschung\b.*\bentwicklung\b|\br&d\b|\bresearch\b/i, code: "72" },

  { keywords: /\b(maschinen|anlagen)bau\b|machinery\s+manufacturer/i, code: "28" },
  { keywords: /\bautomotive\b|\bauto(mobil)?(industrie|hersteller|zulieferer)\b|car\s+manufacturer/i, code: "29" },
  { keywords: /\bzulieferer\b/i, code: "29.32" },
  { keywords: /\bschiffbau\b|shipyard|shipbuilding/i, code: "30.11" },
  { keywords: /\bluft\W?fahrt|aerospace|raumfahrt|aviation/i, code: "30.30" },
  { keywords: /\belektrotechnik|electrical\s+equipment/i, code: "27" },
  { keywords: /\bmetall(verarbeitung|bearbeitung|industrie|bau)\b|metal(working|fabrication)/i, code: "25" },
  { keywords: /\b(stahl|aluminium|kupfer)(werk|industrie)|steel\s+(mill|industry)/i, code: "24" },
  { keywords: /\bchemie\b|chemical\s+(industry|company)|chemikalien/i, code: "20" },
  { keywords: /\bpharma|biotech|life\s*sciences|arzneimittel|medikamente?/i, code: "21" },
  { keywords: /\bkunststoff(verarbeit|industrie)|plastics?(\s+manufacturer)?\b/i, code: "22" },
  { keywords: /\bglas\b|\bkeramik\b|glassworks?|ceramics?/i, code: "23" },
  { keywords: /\bpapier\b|paper\s+mill|paper\s+industry/i, code: "17" },
  { keywords: /\bdruckerei\b|printing\s+(house|company)/i, code: "18" },
  { keywords: /\b(textil|bekleidung|fashion)\b/i, code: "13" },
  { keywords: /\b(brauerei|getr[aä]nke)\b|beverage\s+(producer|manufacturer)/i, code: "11" },
  { keywords: /\b(lebensmittel|food|nahrung|fmcg|consumer\s+goods)\b/i, code: "10" },
  { keywords: /\bmedizintechnik|medical\s+(devices?|technology)/i, code: "32" },
  { keywords: /\belektronik\b|electronics?\s+(manufacturer|industry)/i, code: "26" },
  { keywords: /\bmöbel\b|furniture/i, code: "31" },

  { keywords: /\benergie(versorger|wirtschaft)|utilities|stadtwerke|stromversorger/i, code: "35" },
  { keywords: /\berneuerbar(e)?\s+energien|renewables?|solar|wind(park|kraft)/i, code: "35.11" },
  { keywords: /\bgasversorger|gaslieferant/i, code: "35.21" },
  { keywords: /\babfall(wirtschaft|entsorgung)|waste\s+management|recycling/i, code: "38" },
  { keywords: /\bwasserversorgung|water\s+supply/i, code: "36" },

  { keywords: /\bbau(unternehmen|gewerbe|firma)|construction\s+(company|firm)/i, code: "41" },
  { keywords: /\btiefbau|civil\s+engineering/i, code: "42" },
  { keywords: /\binstallation\b|haustechnik/i, code: "43" },

  { keywords: /\bautohaus\b|car\s+dealer/i, code: "45" },
  { keywords: /\b(gro[ßs]handel|wholesale)/i, code: "46" },
  { keywords: /\b(einzelhandel|retail|handel)\b/i, code: "47" },
  { keywords: /\bonline[\s-]?shop\b|e[\s-]?commerce|webshop|versandhandel/i, code: "47.91" },

  { keywords: /\b(spedition|logistik|logistics|forwarding)\b/i, code: "52.29" },
  { keywords: /\b(transport|fracht|frei?ght)\b/i, code: "49.41" },
  { keywords: /\blager(ei|haltung|halter)?\b|warehousing/i, code: "52.10" },
  { keywords: /\b(reederei|shipping)\b|ocean\s+freight|seefracht/i, code: "50" },
  { keywords: /\b(luftfracht|airline|airways|aviation\s+services?)/i, code: "51" },
  { keywords: /\b(post|kurier|paket|courier|express)\b/i, code: "53" },

  { keywords: /\bhotel\b|hospitality|beherbergung/i, code: "55" },
  { keywords: /\b(restaurant|gastronomie|catering)\b/i, code: "56" },

  { keywords: /\b(bank|kreditinstitut|finanzdienstleist)/i, code: "64.19" },
  { keywords: /\b(versicherung|insurance|reinsurance)\b/i, code: "65" },
  { keywords: /\b(asset\s+management|verm[oö]gensverwaltung|fonds|investment)/i, code: "66" },

  { keywords: /\b(immobilien|real\s+estate|property\s+management)/i, code: "68" },
  { keywords: /\b(makler|brokerage|estate\s+agent)/i, code: "68.31" },

  { keywords: /\b(personaldienstleist|staffing|recruitment|zeitarbeit)/i, code: "78" },
  { keywords: /\b(sicherheits|wachschutz|security\s+services)/i, code: "80" },
  { keywords: /\b(facility\s+management|geb[aä]udereinigung|gebäudemanagement)/i, code: "81" },
  { keywords: /\b(reisebüro|tour\s+operator)/i, code: "79" },
  { keywords: /\b(call\s*center|kundenservice|customer\s+support)/i, code: "82" },

  { keywords: /\b(behörde|verwaltung|government|public\s+sector|öffentliche\s+verwaltung)/i, code: "84" },
  { keywords: /\b(schule|university|hochschule|akademie|education|bildung)/i, code: "85" },
  { keywords: /\bkrankenhaus\b|hospital|klinik(um)?/i, code: "86.10" },
  { keywords: /\b(praxis|arzt|dentist|zahnarzt|gp\s+practice)\b/i, code: "86.21" },
  { keywords: /\b(altenheim|pflegeheim|nursing\s+home)/i, code: "87" },
  { keywords: /\b(sozial(wesen|dienst)|social\s+services)/i, code: "88" },

  { keywords: /\b(verein|verband|interessenvertretung|association)\b/i, code: "94" },
  { keywords: /\b(museum|bibliothek|archiv|library)\b/i, code: "91" },
];

/**
 * Mapped freien Branchentext (oder einen WZ-Code) auf einen WZ-Code aus der
 * Referenzliste. Liefert `WZ_OTHER_CODE` als Fallback. Liefert NIE null —
 * Aufrufer können sich darauf verlassen.
 */
export function mapToWzCode(input: string | null | undefined): string {
  if (!input) return WZ_OTHER_CODE;
  const trimmed = input.trim();
  if (!trimmed) return WZ_OTHER_CODE;
  // 1) Wenn schon ein gültiger WZ-Code übergeben wurde → zurückgeben.
  if (isValidWzCode(trimmed)) return trimmed;
  // 2) Wenn der Eintrag wie ein WZ-Code aussieht aber Stellen fehlen
  //    (z. B. "62" als Abteilung), finden wir ihn schon in (1). Wenn er
  //    feiner ist als unsere Liste (z. B. "62.011"), versuchen wir eine
  //    Eltern-Übereinstimmung.
  const codeShape = trimmed.match(/^\d{2}(?:\.\d{1,2})?$/);
  if (codeShape) {
    const parent = trimmed.slice(0, 2);
    if (isValidWzCode(parent)) return parent;
  }
  // 3) Heuristische Schlagwortsuche.
  for (const h of HEURISTICS) {
    if (h.keywords.test(trimmed)) return h.code;
  }
  return WZ_OTHER_CODE;
}

/**
 * Suggestion-Ergebnis für die Web-Anreicherung. Liefert immer einen
 * tatsächlichen WZ-Code (oder null, wenn nichts erkannt) — kein erzwungenes
 * „Sonstiges" als Default, weil der User dann nichts gewinnt.
 */
export type WzDetection = {
  code: string;
  label: string;
  source: "wz_mention" | "keyword" | "schema_org" | "title";
  confidence: "high" | "medium" | "low";
};

/**
 * Versucht aus einem HTML-Snippet (Impressum/Startseite) und/oder einem
 * Display-Namen einen WZ-Code zu erkennen. Liefert null, wenn nichts klar
 * ableitbar ist — bewusst konservativ, kein „Sonstiges" Default-Vorschlag.
 */
export function detectWzFromHtml(html: string | null, displayName?: string | null): WzDetection | null {
  const text = (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // 1) Direkte Erwähnung eines WZ-/NACE-Codes (z. B. "WZ 62.01" / "NACE 62.01").
  const wzMatch = text.match(/\b(?:WZ\s*2008|WZ|NACE)[:\s-]*(\d{2}(?:\.\d{1,2})?)/i);
  if (wzMatch) {
    const c = mapToWzCode(wzMatch[1]!);
    if (c !== WZ_OTHER_CODE) {
      return { code: c, label: getWzLabel(c) ?? c, source: "wz_mention", confidence: "high" };
    }
  }
  // 2) Schema.org "industry"-Property.
  const schemaMatch = text.match(/"industry"\s*:\s*"([^"]{2,80})"/i);
  if (schemaMatch) {
    const c = mapToWzCode(schemaMatch[1]!);
    if (c !== WZ_OTHER_CODE) {
      return { code: c, label: getWzLabel(c) ?? c, source: "schema_org", confidence: "high" };
    }
  }
  // 3) Heuristische Schlagworte im sichtbaren Text + Display-Name. Wir
  //    suchen die spezifischste Heuristik, die matcht; HEURISTICS ist
  //    bereits nach Spezifität sortiert. Der erste Treffer gewinnt.
  const haystack = `${displayName ?? ""}\n${text}`;
  for (const h of HEURISTICS) {
    if (h.keywords.test(haystack)) {
      const code = h.code;
      // Konfidenz: 4-stellige (Klassen-) Treffer sind spezifisch genug für
      // "medium", 2-stellige Abteilungen bleiben "low".
      const confidence: WzDetection["confidence"] = code.includes(".") ? "medium" : "low";
      return { code, label: getWzLabel(code) ?? code, source: "keyword", confidence };
    }
  }
  return null;
}
