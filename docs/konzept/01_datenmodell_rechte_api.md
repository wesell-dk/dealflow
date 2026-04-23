# DealFlow One
## Erweiterte Fachkonzeption: Datenmodell, Rechte- und API-Zielbild sowie Start des Screen-by-Screen-Konzepts

## Einordnung

Dieses Dokument baut auf der zuvor formulierten Gesamtkonzeption von **DealFlow One** auf und vertieft nun drei zentrale Architektur- und Produktbereiche:

1. **A. Business-Datenmodell / Objektmodell**
2. **B. Rechtemodell und Benutzerlogik**
3. **C. API-Zielbild auf Business-Ebene**
4. **Start des Screen-by-Screen-Konzepts**

Das Ziel ist nicht, an dieser Stelle schon eine technische Implementierung mit finalen Tabellen- oder Endpunktnamen festzuschreiben. Stattdessen wird ein **fachlich belastbares Zielmodell** beschrieben, das als Grundlage für spätere Datenbankstruktur, Backend-Architektur, UI-Konzeption, API-Definition, Rechtekonzept und AI-Orchestrierung dienen kann.

Wichtig ist dabei: DealFlow One ist kein ERP und soll auch nicht zu einem werden. Die Plattform ist bewusst auf den **Commercial Flow** fokussiert – also auf alles, was zwischen Opportunity, Angebot, Genehmigung, Vertrag, Signatur, Auftragsbestätigung, Preisänderung und nachgelagertem kommerziellem Vollzug stattfindet.

---

## A. Business-Datenmodell / Objektmodell

### A.1 Zielsetzung des fachlichen Datenmodells

Das fachliche Datenmodell von DealFlow One muss von Anfang an deutlich mehr leisten als ein klassisches CRM- oder Dokumentenmodell. Es soll nicht nur aktuelle Datensätze speichern, sondern den **gesamten kommerziellen Zustand** eines Vorgangs über Zeit, Organisationseinheiten, Markenlogiken, Versionen und Freigaben hinweg sauber abbilden.

Das Modell muss deshalb gleichzeitig vier Anforderungen erfüllen:

- **operative Arbeitsfähigkeit** im Tagesgeschäft
- **Versionierung und Historisierung** für Angebote, Preise, Verträge und Entscheidungen
- **Governance, Audit und DSGVO-Fähigkeit**
- **Integrations- und AI-Fähigkeit** als Teil der Plattformlogik

Daraus folgt: Das Modell darf nicht oberflächlich dokumentenorientiert gedacht sein. Es muss fachliche Zustände, Beziehungen, Vererbungslogiken, Gültigkeiten und Ausnahmen abbilden können.

### A.2 Grundstruktur des Fachmodells

Das fachliche Gesamtmodell gliedert sich in mehrere Domänen, die klar voneinander getrennt, aber eng miteinander verbunden sind:

- Organisationsdomäne
- Identitäts- und Berechtigungsdomäne
- Kunden- und Beziehungsdomäne
- Deal-Domäne
- Angebots- und Pricing-Domäne
- Vertragsdomäne
- Freigabedomäne
- Signatur- und Abschlussdomäne
- Preisänderungs- und Preiserhöhungsdomäne
- Verhandlungs- und Kommunikationsdomäne
- Analytics- und Performance-Domäne
- Governance-, Audit- und Datenschutzdomäne
- AI- und Orchestrierungsdomäne
- Integrations- und API-Domäne

Diese Trennung ist wichtig, weil sie verhindert, dass später alles in einigen wenigen „Mega-Objekten“ vermischt wird. Genau diese Vermischung ist oft ein Grund, warum komplexe B2B-Systeme später unflexibel, schwer wartbar und schwer integrierbar werden.

### A.3 Organisationsdomäne

Die Organisationsdomäne ist das Fundament der gesamten Plattform. Hier wird festgelegt, in welchem organisatorischen Kontext ein Objekt überhaupt existiert.

#### A.3.1 Plattform

Die Plattform ist die Betreiber-Ebene der SaaS-Lösung. Auf dieser Ebene werden nicht die Geschäftsobjekte der Kunden geführt, sondern übergreifende Steuerungs- und Betriebsaspekte.

Fachlich relevant sind hier unter anderem:

- Mandantenverwaltung
- globale Feature-Freigaben
- Plattform-Policies
- Betriebs- und Sicherheitsmetriken
- Support- und Auditfunktionen
- Rollout- und Release-Logik
- globale Servicegrenzen und Limits

Diese Ebene ist klar von der Mandantenebene zu trennen.

#### A.3.2 Mandant

Der Mandant ist die oberste fachliche Kundeneinheit. Ein Mandant repräsentiert eine Organisation, die DealFlow One nutzt.

Auf Mandantenebene werden unter anderem verwaltet:

- Kundenidentität und Vertragsbeziehung zur Plattform
- gebuchte Module und Paketlogik
- globale Tenant-Einstellungen
- Sprache, Region und Zeitzonenkontext
- tenantweite Integrationen
- tenantweite Datenschutz- und Aufbewahrungsregeln
- tenantweite Richtlinien und Default-Policies
- tenantweite Nutzer- und Sicherheitsvorgaben

Wichtig ist: Der Mandant ist nicht automatisch eine einzelne rechtliche Firma. Innerhalb eines Mandanten können mehrere Firmen existieren.

#### A.3.3 Firma

Innerhalb eines Mandanten kann es mehrere Firmen geben. Diese Firmen können rechtliche, operative oder kommerzielle Einheiten darstellen.

Das ist essenziell für reale Strukturen wie:

- Holdings
- Tochtergesellschaften
- Ländergesellschaften
- Business Units mit eigenem Marktauftritt
- getrennte juristische Vertragspartner
- gruppeninterne Marken- und Produktorganisationen

Eine Firma kann fachlich eigene Regeln und Eigenschaften besitzen, etwa:

- eigene Preislogik
- eigene Angebotsvorlagen
- eigene Vertragslogik
- eigene Freigabeschwellen
- eigene Signaturberechtigungen
- eigene Ansprechpartner und Verantwortlichkeiten
- eigene KPIs und Reports
- eigene rechtliche Angaben im Dokumentenprozess

#### A.3.4 Brand / Branding

Innerhalb einer Firma können mehrere Brands beziehungsweise Brandings existieren. Ein Brand ist dabei nicht nur eine visuelle Ausprägung, sondern ein eigenständiger kommerzieller Kontext.

Ein Brand kann fachlich Einfluss haben auf:

- Angebots- und Vertragsdesign
- Logos, Farben und Layouts
- Textbausteine und Sprachstile
- Dokumentenstruktur
- Produktdarstellung
- markenspezifische Preisübersteuerungen
- Klauselvarianten
- Kommunikationslogik und Absenderdaten
- kundennahe Tonalität und Positionierung

Dadurch wird eine zentrale Anforderung erfüllt: Mehrere Marktauftritte innerhalb eines Mandanten und einer Firma können sauber gesteuert werden, ohne dass dafür redundante Systeminstanzen nötig sind.

#### A.3.5 Organisatorischer Kontext als Pflichtkonzept

Ein zentrales Zielprinzip lautet: Jedes relevante fachliche Objekt muss in seinem organisatorischen Kontext interpretierbar sein.

Das bedeutet: Für ein Angebot, eine Preisposition, einen Vertrag, eine Freigabe oder ein KPI muss immer klar sein, zu welchem Kontext es gehört:

- Mandant
- Firma
- optional Brand

Dieses Prinzip ist für Rechte, Reporting, API, Audit, AI und Governance absolut entscheidend.

### A.4 Identitäts- und Berechtigungsdomäne

Diese Domäne steuert nicht den Geschäftsprozess selbst, sondern den Zugang und die Handlungsfähigkeit von Personen und technischen Identitäten.

Fachobjekte in dieser Domäne sind unter anderem:

- Benutzer
- Team
- Rolle
- Berechtigungsprofil
- Scope-Zuweisung
- Sonderrecht
- Delegation / Vertretung
- Genehmigungsmandat
- technische Integrationsidentität

#### A.4.1 Benutzer

Ein Benutzer ist eine Person, die im System arbeitet. Fachlich relevant ist dabei nicht nur die Identität, sondern auch der zugewiesene organisatorische und funktionale Kontext.

Ein Benutzer benötigt im Modell mindestens folgende fachliche Zuordnungsebenen:

- Zugehörigkeit zu genau einem Mandanten
- mindestens eine Rolle
- mindestens einen Sichtbarkeitsscope
- optional Teamzuordnung
- optionale Sonderrechte oder Restriktionen
- optionale Genehmigungs- oder Vertretungsrechte

#### A.4.2 Team

Teams strukturieren Nutzer fachlich und organisatorisch, etwa nach:

- Vertriebsregion
- Geschäftsbereich
- Produktlinie
- Gesellschaft
- Spezialisierung

Teams sind wichtig für:

- KPI-Auswertungen
- Zuständigkeiten
- Eskalationen
- Freigaberouten
- Reporting
- Verantwortungsmodelle im Deal

#### A.4.3 Rolle

Die Rolle bestimmt, **was** ein Benutzer tun darf. Sie ist von der Sichtbarkeit bewusst zu trennen.

Typische Rollen sind beispielsweise:

- Sales Rep
- Sales Manager
- RevOps / Commercial Ops
- Legal Reviewer
- Finance Approver
- Customer Success Handover
- Read-Only Executive
- Tenant Admin
- Integration Admin
- Brand Manager

#### A.4.4 Scope-Zuweisung

Der Scope bestimmt, **welche Teile der Organisationsstruktur** ein Benutzer sehen darf.

Mögliche fachliche Scope-Ebenen sind:

- gesamter Mandant
- einzelne Firmen
- mehrere Firmen
- einzelne Brands innerhalb einzelner Firmen
- mehrere Brands in mehreren Firmen

Ein Benutzer kann also beispielsweise:

- alles im Mandanten sehen
- nur Firma 1 und Firma 3 sehen
- in Firma 2 nur Brand A und Brand C sehen
- in Firma 4 gar keinen Zugriff haben

Diese Modelltrennung ist für die spätere User Experience enorm wertvoll.

### A.5 Kunden- und Beziehungsdomäne

DealFlow One braucht eine Kunden- und Beziehungsdomäne, die über klassische CRM-Stammdaten hinausgeht. Die Plattform muss nicht nur wissen, **wer der Kunde ist**, sondern auch **welche Rolle welche Person im aktuellen kommerziellen Vorgang einnimmt**.

#### A.5.1 Account

Der Account repräsentiert das Kundenunternehmen oder eine relevante Organisationseinheit auf Kundenseite.

#### A.5.2 Kontakt

Kontakte sind Personen beim Kunden. Ein Kontakt kann in verschiedenen Deals unterschiedliche Rollen einnehmen.

#### A.5.3 Kontaktrolle im kommerziellen Kontext

Ein Kontakt kann beispielsweise sein:

- wirtschaftlicher Entscheider
- fachlicher Ansprechpartner
- Einkauf
- Rechtsabteilung
- technischer Prüfer
- finaler Unterzeichner
- operativer Projektverantwortlicher

Die Kontaktrolle muss deshalb nicht nur Stammdatenwissen sein, sondern pro Deal, Vertrag oder Signaturfall fachlich zugeordnet werden können.

### A.6 Deal-Domäne

Der Deal ist eines der führenden Kernobjekte des Systems. Er bildet den übergeordneten kommerziellen Fall, in dem Angebote, Freigaben, Verträge, Signaturen und Folgeprozesse zusammenlaufen.

#### A.6.1 Deal als Commercial Master Object

Ein Deal bündelt unter anderem:

- Kundenbezug
- Kontakte und ihre Rollen
- organisatorischen Kontext aus Mandant, Firma und Brand
- Deal-Wert und wirtschaftliche Zielgröße
- Deal-Typ und Vertriebssegment
- Phase und Status
- Owner und beteiligte Teams
- Risikoindikatoren
- Angebotsstände
- Vertragsstände
- offene Freigaben
- Signaturstatus
- Auftragsbestätigungsstatus
- Verhandlungszustand
- AI-Zusammenfassungen und Hinweise

#### A.6.2 Ergänzende Deal-nahe Fachobjekte

Zusätzlich braucht die Plattform weitere, mit dem Deal verknüpfte Fachobjekte:

- Deal-Beteiligte
- Deal-Historie
- Deal-Aufgaben
- Deal-Kommentare
- Deal-Ereignisse
- Deal-Risikoindikatoren
- Deal-Prognose
- Deal-KPI-Snapshots

Dadurch wird der Deal zu einer echten operativen Steuerungseinheit und nicht nur zu einer Opportunity-Zeile in einer Pipeline.

### A.7 Angebots- und Pricing-Domäne

Diese Domäne ist ein Herzstück von DealFlow One. Hier entscheidet sich, ob die Plattform später nur hübsche Dokumente erzeugt oder tatsächlich die kommerzielle Intelligenz des Abschlussprozesses trägt.

#### A.7.1 Produkt / Leistung / Leistungsbaustein

Das System benötigt fachliche Leistungsobjekte, auf die sich Preispositionen, Angebotszeilen und Verträge beziehen können. Dabei muss offenbleiben, ob es sich um Produkte, Dienstleistungen, Pakete oder hybride Leistungsmodelle handelt.

#### A.7.2 Preisposition

Die Preisposition ist ein strategisch wichtiges Objekt. Sie darf nicht nur als Zeile in einem Angebot existieren. Sie muss ein eigenständiges, versionierbares und kontextfähiges Fachobjekt sein.

Fachlich relevant sind unter anderem:

- Zugehörigkeit zu Mandant
- optionale Zugehörigkeit zu Firma
- optionale Zugehörigkeit zu Brand
- Gültigkeitszeitraum
- Preisstatus
- Freigabestatus
- Währung
- Bezug zu Produkt oder Leistung
- Regelherkunft
- Historie
- Nachfolge- oder Ersetzungslogik
- Kennzeichnung als Standard, Sonderpreis, Aktion oder Ausnahme

#### A.7.3 Preisregel

Preisregeln beschreiben, unter welchen Bedingungen ein Preis entsteht oder verändert wird. Relevante Einflussfaktoren können sein:

- Menge
- Laufzeit
- Vertragsdauer
- Kundensegment
- Region
- Firma
- Brand
- Deal-Typ
- Mindestmarge
- Freigabeschwelle
- Vertriebsaktion

#### A.7.4 Preisübersteuerung und Prioritätslogik

Das Modell sollte fachlich zwischen verschiedenen Ebenen der Preislogik unterscheiden:

- tenantweiter Standardpreis
- firmenspezifische Ausprägung
- brandspezifische Übersteuerung
- dealbezogene Sonderausnahme

Diese Trennung ist zentral für API, Reporting und Governance. Nur so kann später sauber beantwortet werden, warum ein bestimmter Preis in einem bestimmten Kontext gilt.

#### A.7.5 Preisgültigkeit als eigenes Fachprinzip

Preise sind immer zeitbezogen. Deshalb muss das Modell historische, aktuelle und zukünftige Gültigkeiten sauber abbilden können. Relevant ist nicht nur „was gilt jetzt“, sondern auch:

- was galt zu einem bestimmten Stichtag
- was gilt künftig ab einem Wirksamkeitsdatum
- welcher Preis war zum Zeitpunkt der Angebotsannahme relevant
- welche Version wurde freigegeben, aber noch nicht wirksam

### A.8 Angebotsdomäne

#### A.8.1 Angebot

Das Angebot ist das kaufmännische Oberobjekt, das die geschäftliche Angebotsbeziehung zu einem Deal organisiert.

#### A.8.2 Angebotsversion

Ein Angebot kann und soll mehrere Versionen haben. Diese Versionen sind keine bloßen Dateikopien, sondern fachlich nachvollziehbare Zustände.

Das Modell sollte fachlich unterscheiden können zwischen:

- Entwurfs- oder Arbeitsversion
- zur Freigabe eingereichter Version
- freigegebener Version
- an Kunden gesendeter Version
- aktuell gültiger Version
- angenommener Version
- abgelehnter Version
- durch Gegenvorschlag veränderter Version
- historischer, nicht mehr operativer Version

#### A.8.3 Angebotszeilen

Angebotszeilen verbinden Angebot, Preisposition, Mengen, Rabatte, Laufzeiten, Konditionen, optionale Positionen und kommerzielle Zusätze.

#### A.8.4 Angebotsstatusmodell

Ein belastbares Statusmodell ist essenziell. Fachlich sinnvolle Zustände sind unter anderem:

- in Bearbeitung
- zur Freigabe eingereicht
- freigegeben
- versendet
- vom Kunden geöffnet
- in Verhandlung
- angenommen
- teilweise angenommen
- abgelehnt
- ersetzt
- abgelaufen

#### A.8.5 Maßgeblicher Angebotsstand

Zusätzlich zur Versionierung braucht das Modell ein Konzept des **maßgeblichen kommerziellen Angebotsstands**. Die Plattform muss jederzeit beantworten können:

- Welche Version ist aktuell intern gültig?
- Welche Version liegt aktuell dem Kunden vor?
- Welche Version wurde angenommen?
- Welche Version ist für Folgeprozesse bindend?
- Wurde eine angenommene Version später durch Amendment oder Vertragsänderung fachlich abgelöst?

Dieses Prinzip ist für ERP, Billing, Order Handover und Audit absolut zentral.

### A.9 Verhandlungs- und Kundenreaktionsdomäne

Viele Systeme speichern Verhandlung nur als lose Kommunikationshistorie. DealFlow One sollte hier deutlich stärker sein und Kundenreaktionen als strukturierte Fachobjekte abbilden.

#### A.9.1 Mögliche Reaktionstypen

Das Modell sollte strukturierte Reaktionstypen unterstützen, zum Beispiel:

- vollständig angenommen
- teilweise angenommen
- abgelehnt
- Gegenvorschlag unterbreitet
- Preisänderung gewünscht
- Vertragsänderung gewünscht
- Fristverlängerung gewünscht
- Rückfrage gestellt
- Entscheidung verschoben

#### A.9.2 Gegenvorschläge

Ein Gegenvorschlag sollte kein Freitextrest in einer E-Mail sein, sondern ein strukturierter Bezug auf:

- betroffene Angebotsversion oder Vertragsversion
- gewünschte Änderung
- Preis-, Laufzeit- oder Klauselbezug
- nötige neue Freigaben
- neuen Verhandlungsstand
- resultierende Folgeversionen

#### A.9.3 Verhandlungsrunden

Das System sollte Verhandlung fachlich auch als Serie zusammenhängender Runden interpretieren können. Dadurch werden folgende Fragen leichter beantwortbar:

- Wie viele Verhandlungsrunden waren nötig?
- Welche Themen wurden wiederholt verhandelt?
- An welchem Punkt kippen Deals häufig in Preisnachlass oder Klauselabweichung?
- Welche Mitarbeitenden führen besonders stabile oder effiziente Verhandlungen?

### A.10 Vertragsdomäne

Die Vertragsdomäne ist ein zweites Kernfundament des Produkts. Sie muss sowohl einfache Vertragsgenerierung als auch strukturierte Variantensteuerung, Legal Governance und Verhandlung abbilden.

#### A.10.1 Vertrag

Der Vertrag ist das übergeordnete Objekt, das mit Deal, Angebot, Freigaben und Signatur verknüpft ist.

#### A.10.2 Vertragsversion

Jede relevante Änderung am Vertrag erzeugt einen nachvollziehbaren neuen Stand. Das betrifft nicht nur textliche Änderungen, sondern insbesondere auch:

- Klauselwechsel
- neue kommerzielle Konditionen
- Gegenangebote
- Nachträge / Amendments
- Preisänderungsbezüge

#### A.10.3 Vertragsbausteine

Die Vertragserstellung mit Bausteinen ist eine starke Grundidee, muss aber strukturiert aufgebaut sein. Ein Vertragsbaustein ist ein wiederverwendbarer, fachlich klassifizierbarer Text- und Regelbestandteil.

#### A.10.4 Klauselfamilien

Mehrere Bausteine oder Varianten können zu einer Klauselfamilie gehören, etwa:

- Haftung
- Zahlungsbedingungen
- Kündigung
- Laufzeit
- Verlängerung
- Preisbindung
- Vertraulichkeit
- SLA
- Nutzungsrechte
- Datenschutz

#### A.10.5 Varianten „von zart bis hart“

Jede Klauselfamilie kann mehrere Varianten haben, die fachlich eine Verhandlungsspanne darstellen.

Beispiele:

- zart / weich / kundenfreundlich
- moderat
- Standard
- streng
- hart / sehr unternehmensschützend

Das System sollte diese Varianten nicht nur anzeigen, sondern auch bewerten können. Denkbar sind fachliche Bewertungen wie:

- Standardkonform
- policykritisch
- freigabepflichtig
- risikorelevant
- für bestimmte Firmen oder Brands erlaubt / nicht erlaubt

#### A.10.6 Strukturierte Vertragsintelligenz

Die Plattform sollte später nicht nur Vertragstext rendern, sondern auch folgende Fragen fachlich beantworten können:

- Welche Klauselfamilien weichen vom Standard ab?
- Wo liegen besonders weiche oder harte Formulierungen?
- Welche Klauselvarianten führen regelmäßig zu längeren Verhandlungen?
- Welche Klauseln benötigen Freigaben?
- Welche Vertragsstruktur ist für welchen Deal-Typ oder Brand Standard?

### A.11 Freigabedomäne

Freigaben müssen generisch genug modelliert sein, um für Preise, Angebote, Verträge, Preiserhöhungen, Gegenvorschläge und Sonderfälle gleichermaßen einsetzbar zu sein.

Fachobjekte dieser Domäne sind beispielsweise:

- Freigabepolicy
- Freigaberegel
- Freigabefall
- Freigabeschritt
- Freigabeinstanz
- Eskalation
- Delegation
- Ausnahmeentscheidung
- Begründung
- SLA / Fristlogik

Die Freigabedomäne ist damit nicht an ein einzelnes Dokument gebunden, sondern an fachliche Entscheidungsfälle.

### A.12 Signatur- und Abschlussdomäne

Auch Signatur und Abschluss sollten nicht nur technische Folgeereignisse sein, sondern eigene Fachobjekte.

Relevante Objekte sind:

- Signaturpaket
- Unterzeichnerfolge
- Unterzeichnerrolle
- Signaturstatus
- Signaturereignisse
- Abschlussnachweis
- Auftragsbestätigung
- Übergabestatus an Folgeprozesse

Die Auftragsbestätigung sollte dabei bewusst vom Vertrag und vom Angebot getrennt bleiben, da sie einen eigenen Abschluss- und Übergabestatus im operativen Prozess darstellen kann.

### A.13 Preisänderungs- und Preiserhöhungsdomäne

Die von dir genannte Anforderung, Preiserhöhungsschreiben inklusive Reaktionen, Ablehnungen und Gegenvorschlägen zu unterstützen, ist fachlich äußerst wertvoll und sollte als eigene Domäne behandelt werden.

#### A.13.1 Preiserhöhungsfall

Ein Preiserhöhungsfall ist ein strukturierter kommerzieller Vorgang mit Bezug zu:

- Kunde / Account
- Vertrag
- Preispositionen oder Leistungsgruppen
- Wirksamkeitsdatum
- wirtschaftlicher Begründung
- Freigaben
- Kommunikationsstatus
- Kundenreaktion
- Folgemaßnahmen

#### A.13.2 Kundenreaktionen auf Preiserhöhungen

Mögliche Reaktionen sind unter anderem:

- akzeptiert
- abgelehnt
- später akzeptiert
- Gegenvorschlag unterbreitet
- Fristverlängerung gewünscht
- Kündigungsandrohung
- Eskalation an Management nötig

#### A.13.3 Folgemaßnahmen

Je nach Reaktion können unterschiedliche Folgeprozesse ausgelöst werden:

- Vertragsamendment
- neue Angebotsversion
- Management-Eskalation
- Kulanzfreigabe
- Kündigungsrisikoprüfung
- Übergabe an Customer Success oder Legal

Das macht DealFlow One gerade im Bestandskundengeschäft und bei Revenue Protection besonders stark.

### A.14 Kommunikationsdomäne

Kommunikation darf nicht nur als unstrukturierte Nachrichtenliste existieren. In DealFlow One sollte Kommunikation prozesslogisch nutzbar sein.

Fachobjekte sind beispielsweise:

- Versandereignis
- externer Nachrichtenbezug
- Reminder
- dokumentbezogene Kommunikation
- interne Notiz
- AI-Zusammenfassung
- Eskalationshinweis
- Fristenkommunikation

Dadurch wird Kommunikation auswertbar und kann mit fachlichen Zuständen verbunden werden.

### A.15 Analytics- und Performance-Domäne

Die Plattform soll Vertriebserfolg nicht nur speichern, sondern sauber messbar machen. Dafür braucht sie eine eigene Analyse- und KPI-Domäne.

Mögliche Fachobjekte:

- KPI-Snapshot
- Conversion-Verlauf
- Freigabe-Durchlaufzeit
- Angebotsdurchlaufzeit
- Verhandlungsergebnis
- Deal-Qualität
- Margendisziplin
- Forecast-Abweichung
- Quote-to-Close-Zeit
- Erfolgsquote von Preiserhöhungen
- Policy-Verstoßquote

Wichtig ist, dass KPIs stets organisatorisch kontextualisiert bleiben:

- Mandant
- Firma
- Brand
- Team
- Benutzer
- Deal-Typ
- Vertriebssegment

### A.16 Governance-, Audit- und Datenschutzdomäne

DSGVO und Governance müssen von Anfang an im Modell mitgedacht werden.

Relevante Fachobjekte sind unter anderem:

- Audit-Ereignis
- Zustandsänderung
- Zugriffsprotokoll
- Exportereignis
- sensible-Daten-Klassifikation
- Aufbewahrungsregel
- Löschanforderung
- Anonymisierungsstatus
- Ausnahmeprotokoll
- Policy-Verstoß

Diese Domäne ist nicht nur für Compliance relevant, sondern auch für Vertrauen, Nachvollziehbarkeit, Enterprise Readiness und spätere Zertifizierungsfähigkeit.

### A.17 AI- und Orchestrierungsdomäne

Wenn der AI Copilot wirklich integriert und orchestrierend arbeiten soll, braucht er fachlich definierte Kontexte und Ergebnisse.

Sinnvolle Fachobjekte oder fachliche Zustände sind beispielsweise:

- AI-Arbeitskontext
- AI-Zusammenfassung
- AI-Risikohinweis
- AI-Aktionsvorschlag
- AI-Themenmodus
- AI-Ausführungsprotokoll
- AI-Empfehlung mit Begründung
- AI-Orchestrierungsauftrag

Diese Domäne ist wichtig, damit KI nicht nur als Chatfenster an die Seite geklebt wird, sondern prozessfähig wird.

### A.18 Zentrale Leitprinzipien für die spätere physische Datenbank

Auch ohne technische Implementierungsdetails lassen sich einige klare Grundsätze festhalten:

- Mandant muss ein durchgehender Pflichtkontext sein
- Firma und Brand müssen echte fachliche Scope-Ebenen sein
- Versionierung darf nicht über Überschreiben gelöst werden
- zeitliche Gültigkeiten müssen modellierbar sein
- Preis-, Angebots- und Vertragslogik müssen historisierbar sein
- strukturierte Zustände sind besser als ungebundener Freitext
- AI- und Reporting-Fähigkeit müssen früh mitgedacht werden
- DSGVO- und Audit-Fähigkeit sind Kernanforderungen, keine Nebenaufgabe

---

## B. Rechtemodell und Benutzerlogik

### B.1 Zielbild des Rechtemodells

Das Rechtemodell von DealFlow One muss zwei gegensätzliche Anforderungen gleichzeitig erfüllen:

- Es muss **für Administratoren verständlich und beherrschbar** sein.
- Es muss **für komplexe Organisationsstrukturen fein genug** sein.

Deshalb sollte es nicht als einfaches Rollenmodell, sondern als mehrschichtiges Zugriffsmodell aufgebaut werden.

### B.2 Die vier Ebenen des Zugriffsmodells

Das Zielmodell besteht aus vier Ebenen:

1. **Identität** – Wer ist die Person oder technische Einheit?
2. **Rolle** – Was darf sie funktional tun?
3. **Scope** – Welche Firmen und Brands darf sie sehen?
4. **Policy-Zusatzregeln** – Welche sensiblen Inhalte oder Sonderaktionen sind zusätzlich erlaubt oder verboten?

Diese vier Ebenen zusammen erzeugen die tatsächliche Zugriffswirklichkeit.

### B.3 Identität

Die Identität ist die fachliche Grundlage jedes Zugriffs. Sie kann eine natürliche Person oder später auch eine technische Integrationsidentität sein.

Wesentliche Punkte sind:

- Zugehörigkeit zu genau einem Mandanten
- eindeutiger Status aktiv / inaktiv / gesperrt
- optional mehrere organisatorische Zuordnungen
- Nachvollziehbarkeit für Audit
- potenzielle Verknüpfung zu SSO oder externem Identity Provider

### B.4 Rolle: Was darf jemand grundsätzlich tun?

Die Rolle definiert die fachliche Handlungsfähigkeit. Typische Rollen sind:

- Sales Rep
- Sales Manager
- Account Executive
- RevOps / Commercial Ops
- Legal Reviewer
- Finance Approver
- Read-Only Executive
- Customer Success Handover
- Tenant Admin
- Brand Manager
- Integration Admin

Diese Rollen sollten keine Sichtbarkeit implizieren. Sonst würden Rechte und Datenzugriff vermischt.

### B.5 Scope: Was darf jemand sehen?

Der Scope regelt die organisatorische Sichtbarkeit. Das ist gerade in deinem Modell mit mehreren Firmen und mehreren Brands pro Firma absolut entscheidend.

Mögliche Scope-Ebenen:

- gesamter Mandant
- eine oder mehrere Firmen
- eine oder mehrere Brands innerhalb bestimmter Firmen
- optional zusätzlich Team- oder Segmentfilter

Ein Benutzer kann also fachlich zum Beispiel so aussehen:

- Rolle: Sales Rep
- Scope: Firma 1 vollständig, Firma 2 nur Brand A, Firma 3 kein Zugriff

Diese Präzision ist die Basis für sichere Multi-Company- und Multi-Brand-Nutzung.

### B.6 Trennung von „sehen“, „bearbeiten“, „freigeben“, „exportieren“

Ein starkes Rechtemodell trennt nicht nur Sichtbarkeit und Rollen, sondern auch verschiedene Arten von Handlungsrechten.

Beispiele:

- Ein Benutzer kann Deals sehen, aber nicht bearbeiten.
- Ein Benutzer kann Angebote bearbeiten, aber nicht freigeben.
- Ein Benutzer kann Verträge lesen, aber keine Klauselvarianten wechseln.
- Ein Benutzer kann Reports sehen, aber keine personenbezogenen Daten exportieren.
- Ein Benutzer kann Preispositionen lesen, aber keine Preisregeln ändern.

Diese Trennung ist besonders für Governance und Enterprise-Tauglichkeit wichtig.

### B.7 Policy-Zusatzregeln für sensible Bereiche

Zusätzlich zu Rolle und Scope braucht DealFlow One Fachregeln für sensible Inhalte. Diese Zusatzregeln können unter anderem betreffen:

- Margensichtbarkeit
- Preisregeln und Kalkulationslogiken
- harte Vertragsklauseln
- personenbezogene Exportrechte
- API-Credential-Verwaltung
- Audit- und Governance-Funktionen
- Preisänderungsfreigaben
- Zugriff auf vertrauliche Redline-Informationen

Damit kann das System sehr präzise zwischen allgemeiner Nutzbarkeit und sensiblen Verwaltungsbereichen unterscheiden.

### B.8 Mandantenadmin als Schlüsselrolle

Der Tenant Admin wird in DealFlow One zu einer der wichtigsten Rollen. Er ist nicht nur „technischer Admin“, sondern der organisatorische Regisseur des Mandanten.

Seine Aufgaben umfassen unter anderem:

- Benutzer anlegen, deaktivieren und strukturieren
- Rollen zuweisen
- Scopes auf Firmen und Brands vergeben
- Teams definieren
- Sonderrechte vergeben
- API-Integrationen verwalten
- Preis- und Vorlagenverwaltung freischalten
- Freigabe- und Governance-Strukturen konfigurieren
- Datenschutz- und Exportrechte steuern

Der Tenant Admin braucht daher eine sehr klare und verständliche Benutzeroberfläche.

### B.9 Delegation und Vertretung

Ein reifes Rechtemodell muss auch temporäre oder prozessbezogene Rechte unterstützen, zum Beispiel:

- Urlaubsvertretung
- einmalige Freigabedelegation
- Eskalationsvertretung
- temporäre Mitarbeit in Sonderdeals
- befristeter Krisenzugriff mit Auditpflicht

Gerade in Vertriebs- und Freigabeprozessen ist diese Flexibilität entscheidend, um Stillstand zu vermeiden.

### B.10 Freigaberechte als Sonderdimension

Nicht jeder Bearbeiter darf automatisch auch freigeben. Freigaben sollten deshalb als eigenständige Fähigkeit modelliert werden.

Ein Benutzer kann beispielsweise:

- Preise bis zu einer bestimmten Schwelle freigeben
- nur Vertragsabweichungen einer bestimmten Risikoklasse freigeben
- nur für bestimmte Firmen oder Brands freigeben
- in Vertretung freigeben
- nur kommentieren, aber nicht final entscheiden

Das erhöht die Präzision und reduziert Governance-Risiken.

### B.11 Zugriffsauswertung: empfohlene Prüfsequenz

Bei jedem relevanten Zugriff sollte das System fachlich dieselbe Reihenfolge prüfen:

1. Gehört der Benutzer zum richtigen Mandanten?
2. Liegt die angeforderte Firma im Scope?
3. Liegt der angeforderte Brand im Scope?
4. Erlaubt die Rolle die gewünschte Aktion?
5. Gibt es sensible Zusatzregeln, die den Zugriff einschränken?
6. Liegt eine Delegation oder Vertretung vor?
7. Muss der Zugriff besonders auditiert werden?

Diese Logik ist sowohl für UI als auch für API wichtig.

### B.12 Scope-Vererbung

Um die Administration praktikabel zu halten, sollte Scope eine gewisse Vererbungslogik besitzen:

- Mandantenscope umfasst standardmäßig alle Firmen und Brands
- Firmenscope umfasst standardmäßig alle Brands dieser Firma
- Brandscope gilt nur für genau die gewählten Brands

Zusätzlich kann es explizite Ausschlüsse geben, wenn das Fachmodell später dafür Bedarf zeigt.

### B.13 Beispiele für reale Benutzerfälle

#### Fall 1: Konzernvertriebsleiter

- Rolle: Sales Manager
- Scope: gesamter Mandant
- Zusatzrechte: Margen sichtbar, Freigaben bis definierte Schwelle, Team-KPIs

#### Fall 2: Vertriebsmitarbeiter für eine Gesellschaft

- Rolle: Sales Rep
- Scope: Firma 1, alle Brands
- Zusatzrechte: keine Preisregelbearbeitung, keine Exportrechte

#### Fall 3: Brand-Verantwortlicher

- Rolle: Brand Manager
- Scope: Firma 2, nur Brand B
- Zusatzrechte: Vorlagen und Branding-Konfiguration, keine Vertragsfreigabe

#### Fall 4: Legal Reviewer

- Rolle: Legal Reviewer
- Scope: Firmen 1 und 3, alle zugehörigen Brands
- Zusatzrechte: Vertragsvarianten prüfen, Redline-Bearbeitung, Freigabe bestimmter Klauselabweichungen

#### Fall 5: Integration Admin

- Rolle: Integration Admin
- Scope: definierte Firmen / Brands
- Zusatzrechte: API-Zugänge, Webhooks, Integrationsmonitoring, keine operative Deal-Bearbeitung nötig

Diese Beispiele zeigen, wie wichtig die Trennung von Rolle, Scope und Zusatzrechten ist.

### B.14 UX-Prinzip für die Benutzerverwaltung

Die Benutzerverwaltung darf sich nicht wie ein technisches Rechtemodul anfühlen. Sie sollte organisatorisch lesbar sein.

Eine gute Admin-Oberfläche beantwortet pro Benutzer klar:

- Wer ist die Person?
- Welche Rolle hat sie?
- Welche Firmen sieht sie?
- Welche Brands sieht sie?
- Welche sensiblen Inhalte darf sie sehen?
- Welche Freigaben darf sie durchführen?
- Welche Integrationen darf sie verwalten?

So wird die Administration auch für Nicht-Techniker verständlich.

### B.15 DSGVO- und Sicherheitsrelevanz des Rechtemodells

Das Rechtemodell ist nicht nur eine Komfortfunktion, sondern auch ein Datenschutz- und Governance-Werkzeug.

Es trägt dazu bei, dass:

- Datenminimierung umgesetzt werden kann
- nur berechtigte Personen personenbezogene Daten sehen
- sensible Vertrags- oder Preisinformationen geschützt bleiben
- Exporte kontrolliert werden
- Zugriffe auf kritische Informationen auditierbar bleiben

Damit ist das Rechtemodell ein aktiver Teil der DSGVO-Fähigkeit des Produkts.

---

## C. API-Zielbild auf Business-Ebene

### C.1 Rolle der API in DealFlow One

Die API darf in DealFlow One nicht wie ein bloßer technischer Zusatz wirken. Sie sollte als **Commercial Integration Layer** verstanden werden. Diese Schicht liefert nicht nur Rohdaten, sondern den fachlich gültigen kommerziellen Zustand.

Der Unterschied ist wesentlich:

- Eine gewöhnliche API gibt einzelne Datensätze zurück.
- Eine starke Commercial API liefert den **kontextualisierten, freigegebenen, versionierten und organisatorisch gültigen Stand**.

Genau das macht DealFlow One integrationsseitig besonders.

### C.2 API-Ziele

Die API sollte mindestens folgende Ziele erfüllen:

- sichere Integration externer Systeme
- klare Mandanten- und Scope-Trennung
- Zugriff auf operative Commercial States
- Versionierungs- und Historienfähigkeit
- Eventing bei relevanten Zustandsänderungen
- Auditierbarkeit und Governance
- Eignung für ERP, Billing, Delivery, BI und AI-nahe Folgeprozesse

### C.3 Drei Integrationsmodi

Die Plattform sollte aus fachlicher Sicht drei Integrationsmodi anbieten:

#### C.3.1 Read API

Externe Systeme lesen fachlich gültige Zustände aus DealFlow One.

#### C.3.2 Event / Webhook API

DealFlow One informiert andere Systeme aktiv über relevante Änderungen.

#### C.3.3 Write-back / Callback

Externe Systeme geben Bestätigungen, Referenzen oder Folgeinformationen zurück.

Diese Dreiteilung verhindert, dass Integrationen zu einseitigen Datenkopien verkommen.

### C.4 Fachliche API-Domänen

Die API sollte mindestens auf folgenden Domänen sauber definierbar sein:

- Organisationskontext
- Preispositionen
- Preisgültigkeit und Preisquellen
- Angebotsstände und Angebotsversionen
- angenommenes / aktuell bindendes Angebot
- Vertragsstatus
- Signaturstatus
- Auftragsbestätigungsstatus
- Preiserhöhungsfälle
- Kundenreaktionen
- Events / Webhooks
- Reporting-nahe Read-Modelle

### C.5 Best-in-class Preispositionsabfrage

Die Preispositionsabfrage ist eines der spannendsten Features in deinem Zielbild. Sie sollte deutlich mehr können als ein einfaches „gib mir Preis für X“.

Die API sollte fachlich beantworten können:

- Gibt es die Preisposition im Tenant-Kontext?
- Gibt es eine firmenspezifische Ausprägung?
- Gibt es eine brandbezogene Übersteuerung?
- Welche freigegebene Version ist aktuell gültig?
- Seit wann gilt sie?
- Welche Quelle hat gewonnen?
- Gibt es bereits eine zukünftige Nachfolgeversion?
- Ist die Position ausgelaufen oder ersetzt?

### C.6 Fachliche Prioritätslogik bei Preisen

Ein technisch herausragender Ansatz ist eine klare Auflösungslogik.

Die Priorität könnte fachlich so aussehen:

1. Brand-spezifischer freigegebener Preis
2. Firmen-spezifischer freigegebener Preis
3. tenantweiter Standardpreis
4. optionale dealbezogene Ausnahme, falls der Anwendungsfall Deal-spezifisch ist

Der große Vorteil: Externe Systeme müssen diese Logik nicht selbst nachbauen.

### C.7 Zeitbezogene Preisabfrage

Die API sollte nicht nur den aktuellen Preis liefern, sondern auch Stichtags- und Zukunftsabfragen fachlich unterstützen, etwa:

- gültiger Preis heute
- gültiger Preis zu einem historischen Datum
- nächste bereits freigegebene Preisversion
- Preisstand zum Angebots- oder Vertragsdatum

Gerade für ERP, Billing und Preiserhöhungsfälle ist diese Fähigkeit außerordentlich wertvoll.

### C.8 Read Model für das aktuell gültige und angenommene Angebot

Ein zentrales Highlight sollte eine fachlich starke Abfrage des **aktuell gültigen und angenommenen Angebots** sein.

Dieses Read Model sollte mindestens Folgendes liefern:

- welches Angebot oder welche Angebotsfamilie gemeint ist
- welche Version die angenommene Version ist
- wann die Annahme erfolgte
- welche Preis- und Konditionsbasis gilt
- welcher Vertrag dazugehört
- ob Signaturen vorliegen
- ob eine Auftragsbestätigung erzeugt wurde
- in welchem Mandanten-, Firmen- und Brand-Kontext der Fall steht
- ob nach Annahme bereits Amendments oder Folgeänderungen erfolgt sind

Dadurch erhält ein ERP oder Folgeprozess den fachlich maßgeblichen Stand, statt Dokumente selbst interpretieren zu müssen.

### C.9 Warum dieses Angebots-Read-Model so stark ist

Viele Systeme liefern nur einen Dateilink oder einen Status wie „accepted“. Das reicht in komplexen Umgebungen nicht.

DealFlow One sollte stattdessen den **maßgeblichen Commercial State** liefern. So muss ein externes System nicht selbst herausfinden:

- welche Version korrekt ist
- ob eine Annahme formal vollständig ist
- ob parallel ein Gegenvorschlag noch offen ist
- ob der Vertrag bereits signiert oder nur freigegeben wurde
- ob die Auftragsbestätigung schon erstellt wurde

Das spart Integrationsaufwand und vermeidet Fehlinterpretationen.

### C.10 Eventing / Webhooks

Neben Pull-Abfragen sollte DealFlow One wichtige Zustandsänderungen aktiv kommunizieren.

Fachlich relevante Ereignisse sind zum Beispiel:

- Preisposition freigegeben
- Preisposition wirksam geworden
- Angebot versendet
- Angebot angenommen
- Angebot abgelehnt
- Gegenvorschlag eingegangen
- Vertrag freigegeben
- Vertrag signiert
- Auftragsbestätigung erzeugt
- Preiserhöhungsschreiben versendet
- Preiserhöhung akzeptiert
- Preiserhöhung abgelehnt

Damit können ERP, Billing, Delivery oder BI nahezu in Echtzeit reagieren.

### C.11 Sicherheitsmodell der API

Die API muss dieselben Schutzprinzipien wie die UI einhalten:

- technische Identitäten gehören immer genau zu einem Mandanten
- Zugriffe sind zusätzlich an Scopes gebunden
- Firmen- und Brand-Kontexte werden geprüft
- sensible API-Bereiche sind separat freischaltbar
- alle Zugriffe sind auditierbar

Optional für größere Kunden denkbar:

- mehrere Integrationsprofile je Mandant
- getrennte Rechte für Lesen, Eventing und Rückschreiben
- erweiterte Sicherheits- und Härtungsoptionen

### C.12 API aus Sicht eines ERP

Ein ERP oder operatives Folgesystem sollte in einem idealen Modell drei Dinge tun können:

#### C.12.1 Preise lesen

Zum Beispiel im Sinne von: „Was ist die aktuell gültige Preisposition für Produkt X im Kontext Firma 1 und Brand A?“

#### C.12.2 Commercial State lesen

Zum Beispiel im Sinne von: „Was ist das aktuell angenommene und operative Angebot für Deal Y oder Kunde Z?“

#### C.12.3 Folgezustände empfangen

Zum Beispiel im Sinne von: „Der Vertrag wurde signiert, die Auftragsbestätigung wurde erzeugt, die Übergabe ist bereit.“

Dadurch bleibt die kommerzielle Logik in DealFlow One und muss nicht im ERP nachgebaut werden.

### C.13 API und Versionierung

Auch die API selbst muss versionsbewusst sein – fachlich und technisch.

Fachlich bedeutet das:

- aktuelle operative Sicht
- historischer Stichtagsblick
- Referenz auf freigegebene Versionen
- Nachvollziehbarkeit, welcher Stand wann maßgeblich war

Technisch bedeutet das später, dass die API stabil weiterentwickelt werden kann, ohne bestehende Integrationen zu brechen.

### C.14 API und AI

Der AI Copilot sollte perspektivisch kontrolliert API-nah nutzbar sein – nicht als freie Blackbox, sondern als klar geregelte Business-Funktion.

Sinnvolle spätere AI-nahe Integrationsfunktionen wären beispielsweise:

- Deal-Zusammenfassung
- Begründung eines Preisstands
- Vergleich zweier Angebotsversionen
- Zusammenfassung offener Verhandlungspunkte
- Risikoeinschätzung bei Vertragsvarianten

Diese Fähigkeiten sollten jedoch stets governance- und rollenbewusst freigeschaltet werden.

---

## Start des Screen-by-Screen-Konzepts

## D. Leitidee für das Screen-Modell

Die Oberfläche von DealFlow One muss das zentrale Produktversprechen einlösen: **sehr einfach an der Oberfläche, sehr stark in der Tiefe**.

Das Screen-by-Screen-Konzept sollte deshalb nicht aus isolierten Einzelscreens bestehen, sondern aus einer zusammenhängenden Arbeitslogik. Nutzer sollen jederzeit verstehen:

- in welchem Kontext sie arbeiten
- welcher kommerzielle Zustand gerade gilt
- was der nächste sinnvolle Schritt ist
- was blockiert
- welche Rolle sie selbst dabei spielen

Die Screens sollten daher drei Hauptziele erfüllen:

- Orientierung schaffen
- Entscheidungen beschleunigen
- Komplexität kapseln

## D.1 Screen 1: Login, Identität und Mandantenkontext

### Zweck

Der Einstieg in das System muss Sicherheit, Klarheit und Kontext liefern. Gerade bei mehreren Firmen und Brands pro Mandant ist es wichtig, dass der Nutzer sofort versteht, in welchem sichtbaren Raum er arbeitet.

### Fachliche Anforderungen

- sichere Authentifizierung / SSO-Anbindung
- Zuordnung des Nutzers zu genau einem oder mehreren Mandanten
- Anzeige des zulässigen organisatorischen Kontexts
- Berücksichtigung des zuletzt genutzten Firmen- und Brand-Kontexts
- optional direkte Weiterleitung in persönliche Aufgaben oder offene Freigaben

### UX-Ziel

Bereits im Einstieg darf es keine Verwirrung geben. Ein Benutzer mit beschränktem Scope darf keine unnötigen, leeren oder unzulässigen Auswahlmöglichkeiten sehen.

## D.2 Screen 2: Home Dashboard

### Zweck

Das Dashboard ist der persönliche Kontrollturm des Nutzers. Es zeigt nicht „alles“, sondern das fachlich Relevante im erlaubten Scope.

### Inhaltliche Struktur

- Kopfbereich mit Mandant, Firma, Brand, Suche und AI-Zugang
- priorisierte Kacheln im Hauptbereich
- Aufgaben- und Eskalationsspalte
- KPI- und Statusmodule im unteren Bereich

### Typische Inhalte

- offene Deals
- blockierte Deals
- wartende Freigaben
- ablaufende Angebote
- ausstehende Signaturen
- kritische Preisänderungsfälle
- Kundenreaktionen
- persönliche To-dos
- Team- und Vertriebs-KPIs

### Besondere Stärke

Das Dashboard ist vollständig scope-gefiltert. Ein Benutzer sieht nur relevante Firmen, Brands, Deals und Freigaben.

## D.3 Screen 3: Deal Room

### Zweck

Der Deal Room ist das operative Herz der gesamten Plattform. Hier laufen Angebotsstand, Vertragsstand, Verhandlung, Freigabe, Signatur und Abschlusslogik zusammen.

### Zielbild

Der Deal Room sollte jederzeit beantworten können:

- Wo steht dieser Deal gerade?
- Welcher Angebotsstand ist maßgeblich?
- Ist der Vertrag noch in Prüfung oder bereits signaturbereit?
- Gibt es offene Freigaben?
- Gibt es Kundenreaktionen oder Risiken?
- Was ist der nächste beste Schritt?

### Struktur

- Header mit Deal-Kerninformationen
- zentrale Deal-Zusammenfassung
- Timeline / Aktivitätsstrom
- Statuskarten für Angebot, Preis, Vertrag, Signatur und Auftragsbestätigung
- Seitenspalte mit AI-Zusammenfassung, offenen Risiken und nächsten Aktionen
- Tabs für Dokumente, Kommunikation, KPI, Historie und Beteiligte

### Warum dieser Screen so wichtig ist

Wenn DealFlow One erfolgreich sein soll, muss der Deal Room zum Ort werden, an dem Vertrieb, RevOps, Legal und Management denselben kommerziellen Fall verstehen – jeweils aus ihrer Perspektive, aber auf einer gemeinsamen Datenbasis.

## D.4 Screen 4: Quote Studio

### Zweck

Das Quote Studio ist der Arbeitsbereich für Angebotsaufbau, Angebotsversionen, Preislogik und Dokumentenerstellung.

### Fachlicher Fokus

- Angebotszeilen strukturieren
- Preispositionen auswählen
- Mengen und Laufzeiten anpassen
- Rabatte und Sonderkonditionen prüfen
- Freigabebedarf sichtbar machen
- Versionen vergleichen
- Dokumentenvorschau anzeigen

### Besondere Anforderungen

- automatische Berücksichtigung von Firmen- und Brand-Kontext
- sichtbare Erklärung, warum ein Preis gilt
- Transparenz über Freigaben und Policy-Abweichungen
- Nachvollziehbarkeit von Angebotsänderungen

## D.5 Screen 5: Tenant Admin Console

### Zweck

Die Tenant Admin Console ist die Steuerzentrale für die von dir geforderte Mandanten-, Firmen-, Brand- und Scope-Logik.

### Kernbereiche

- Firmenverwaltung
- Brand- und Branding-Verwaltung
- Benutzerverwaltung
- Rollen und Scope-Zuweisungen
- Teams
- Vorlagen und Dokumentenwelten
- Preislogiken und Preispositionen
- Vertragsbausteine und Klauselvarianten
- API- und Integrationsverwaltung
- Datenschutz- und Exportoptionen

### Besondere Bedeutung

Dieser Screen entscheidet darüber, ob die Plattform trotz Komplexität administrierbar bleibt.

## Ausblick auf die nächsten Screen-by-Screen-Schritte

Im nächsten Ausbau sollten diese Screens vollständig und einzeln vertieft werden:

1. Home Dashboard
2. Deal List / Pipeline
3. Deal Room
4. Quote Studio
5. Pricing Workspace
6. Approval Hub
7. Contract Workspace
8. Negotiation & Counterproposal Workspace
9. Signature Center
10. Order Confirmation & Handover Center
11. Price Increase Center
12. Reports & Performance Cockpit
13. AI Copilot Workspace
14. Tenant Admin Console
15. Platform Admin Console

Dieses Dokument bildet damit die inhaltliche Brücke zwischen Gesamtvision, Facharchitektur und detailliertem Screen Design.
