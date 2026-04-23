# DealFlow One – Vollständig neu formulierte, erweiterte Gesamtkonzeption

## 1. Executive Summary

DealFlow One ist eine best-in-class Commercial Execution Platform für B2B-Unternehmen, die ihren gesamten kommerziellen Abschlussprozess in einer einzigen, klaren und leistungsstarken Anwendung steuern wollen. Der Fokus liegt auf allem, was zwischen einer Opportunity und einem sauber geregelten Abschluss passiert: Angebotserstellung, Preislogik, Genehmigungen, Vertragserstellung, Signatur, Auftragsbestätigung, Preisänderungen, Reaktionen des Kunden und anschließende Übergabe an nachgelagerte Systeme.

Im Unterschied zu klassischen CRM-, ERP-, CPQ- oder CLM-Systemen ist DealFlow One konsequent deal-zentriert gedacht. Es ist kein ERP, keine Buchhaltung und kein bloßer Dokumentengenerator. Es ist die operative Schaltzentrale für den kommerziellen Abschluss.

Mit den erweiterten Anforderungen entwickelt sich DealFlow One zusätzlich zu einer multimandantenfähigen Plattform, die pro Mandant mehrere Firmen und pro Firma mehrere Marken bzw. Brandings abbilden kann. Benutzer können dabei gezielt so berechtigt werden, dass sie alles im Mandanten sehen, nur bestimmte Firmen sehen oder sogar nur bestimmte Marken innerhalb bestimmter Firmen sehen.

## 2. Die zentrale Produktidee

DealFlow One macht aus einem fragmentierten, fehleranfälligen und intransparenten Abschlussprozess einen einheitlichen, intelligenten und steuerbaren Commercial Flow.

Das System vereint an einem Ort Deals, Angebote, Preispositionen, Freigaben, Vertragsbausteine, Verhandlungen, Signaturen, Auftragsbestätigungen, Preiserhöhungsschreiben, Ablehnungen und Gegenvorschläge, Vertriebsmessung sowie AI-gestützte Orchestrierung.

## 3. Designprinzip: Simple on the surface, powerful underneath

An der Oberfläche muss die App sehr klar aufgebaut sein, eine starke visuelle Ordnung haben, wenige Hauptbereiche besitzen, rollenorientiert funktionieren und dem Nutzer stets den nächsten sinnvollen Schritt zeigen.

Unter der Oberfläche braucht die Plattform gleichzeitig Tiefe und Belastbarkeit: Multi-Tenant-Fähigkeit, Multi-Company-Fähigkeit, Multi-Brand-Fähigkeit, scope-basierte Benutzerrechte, Preis- und Gültigkeitslogik, Vertragsvarianten, Audit Trails, Versionierung, API-Zugriff, DSGVO-Fähigkeit, Event- und Workflow-Orchestrierung sowie AI-Unterstützung über den gesamten Prozess.

## 4. Organisatorisches Kernmodell

Die Zielstruktur ist:
- Plattform
- Mandant
- Firmen innerhalb des Mandanten
- Brands / Marken / Brandings innerhalb einer Firma
- Benutzer
- Rollen + Sichtbarkeitsscope

Dieses Modell ist stark, weil es reale Unternehmensstrukturen besser abbildet als herkömmliche Ein-Mandant-eine-Firma-Ansätze.

## 5. Mandant, Firma, Brand: die Hierarchie

### Mandant
Auf Mandantenebene werden unter anderem organisiert:
- grundsätzliche Identität des Kunden
- Paket und Lizenzmodell
- globale Einstellungen
- Integrationen auf Mandantenebene
- Benutzerverwaltung
- Sicherheitsrichtlinien
- Sprache, Region, Compliance-Optionen
- globale Standardregeln

### Firmen innerhalb eines Mandanten
Ein Mandant kann mehrere Firmen enthalten, z. B. für Holdingstrukturen, Ländergesellschaften, Tochterfirmen, Geschäftsbereiche oder rechtlich getrennte Vertragspartner. Jede Firma kann eigene Preislisten, Dokumentenvorlagen, rechtliche Texte, Freigaberegeln, Signaturberechtigungen, Vertragspartnerangaben und Reports haben.

### Brands / Marken pro Firma
Innerhalb einer Firma kann es mehrere Brands geben. Ein Brand beeinflusst Angebotsdesign, Logos und Farben, Textbausteine, Produktdarstellung, Preislogik, Vertragsbausteine, Kommunikationsstil, Absenderdaten und Kundenerlebnis im Dokumentenprozess.

## 6. Sichtbarkeit und Berechtigung

Das Berechtigungsmodell besteht aus zwei Ebenen:

### Rolle
Die Rolle bestimmt, was ein Benutzer tun darf, z. B. Vertriebsmitarbeiter, Vertriebsleiter, Legal Reviewer, Finance Approver, RevOps Admin, Tenant Admin oder Read-Only Executive.

### Scope
Der Scope bestimmt, welche organisatorischen Bereiche ein Benutzer sehen darf. Mögliche Scope-Stufen:
- gesamter Mandant
- ausgewählte Firmen
- ausgewählte Brands innerhalb ausgewählter Firmen
- optional zusätzlich nur bestimmte Teams oder Deal-Typen

## 7. Mandantenadmin und Benutzerverwaltung

Der Mandantenadmin muss Benutzer anlegen und deaktivieren, Rollen zuweisen, Sichtbarkeit auf Firmen und Brands vergeben, Teams strukturieren, Standardwerte festlegen, Vorlagen und Brandings verwalten, Freigabematrizen pflegen, Integrationen verwalten, API-Zugänge steuern sowie Audit- und Exportrechte kontrollieren.

## 8. DealFlow One als Commercial System of Record

DealFlow One soll im Commercial-Bereich zum führenden System der Wahrheit werden. Relevante Preispositionen liegen sauber modelliert vor, Angebotsversionen sind nachvollziehbar, angenommene Angebote sind eindeutig identifizierbar, Vertragsversionen sind historisiert, Kundenreaktionen werden formal erfasst und alle Vorgänge sind organisatorisch eindeutig einem Mandanten, einer Firma und optional einer Marke zugeordnet.

## 9. Kerndomänen des Produkts

DealFlow One umfasst mindestens:
- Organisationsdomäne
- Identitäts- und Berechtigungsdomäne
- Kunden- und Beziehungsdomäne
- Deal-Domäne
- Angebots- und Pricing-Domäne
- Vertragsdomäne
- Genehmigungsdomäne
- Signaturdomäne
- Kommunikations- und Verhandlungsdomäne
- Analytics- und Performance-Domäne
- Integrations- und API-Domäne
- Datenschutz- und Governance-Domäne
- AI- und Orchestrierungsdomäne

## 10. Plattformfähige Datenbasis

Die Datenbank muss drei Logiken sauber abbilden:
1. operative Kernobjekte
2. Historie und Versionierung
3. Ereignis- und Audit-Schicht

Neben dem aktuellen Stand muss nachvollziehbar sein, wer was geändert hat, warum, in welchem Scope und welcher Zustand zu einem bestimmten Zeitpunkt gültig war.

## 11. Preispositionen als erstklassiges Objekt

Eine Preisposition ist mehr als eine Zeile in einem Angebot. Sie muss kontextfähig und versionierbar sein. Dazu gehören fachlich mindestens Zugehörigkeit zu Mandant, Firma und optional Brand, Gültigkeitszeitraum, Währung, Preisstatus, Freigabestatus, Historie, Verwendungsbezug in Angeboten, Verknüpfung zu Preisregeln sowie Kennzeichnung als Standard-, Sonder- oder Aktionspreis.

## 12. Best-in-class Idee für die Preispositions-API

Die Plattform stellt tenant-kontextfähige, scope-bewusste Preisabfragen bereit. Ein ERP oder anderes externes System kann gezielt abfragen:
- welche Preisposition aktuell gültig ist
- ob es für eine Firma eine spezifische Ausprägung gibt
- ob für eine Marke eine spezifische Übersteuerung gilt
- welche Version freigegeben ist
- ab wann sie gilt
- ob eine Nachfolgeposition existiert
- und ob der zurückgegebene Wert der aktuelle operative Stand ist

Best-in-class wird dies durch hierarchische Auflösung, zeitbezogene Abfrage, statussichere Antwort, Transparenz über Herkunft und Eventfähigkeit.

## 13. Abfrage des aktuell gültigen und angenommenen Angebots

Die Plattform soll jederzeit eindeutig machen:
- welche Angebotsversion aktuell gültig ist
- welche Version dem Kunden vorliegt
- welche Version angenommen wurde
- welche Version abgelehnt wurde
- und ob aktuell ein Gegenvorschlag verhandelt wird

Externe Systeme sollten den maßgeblichen Commercial State erhalten können: bindende Angebotsversion, Annahmestatus, Zeitpunkt der Annahme, Preis- und Konditionsbasis, Verknüpfung zu Vertrag und Auftragsbestätigung sowie Mandant, Firma und Brand.

## 14. Versionierung als Grundprinzip

Versioniert werden sollten mindestens:
- Angebote
- Preispositionen
- Preisregeln
- Vertragsdokumente
- Vertragsbausteine
- Genehmigungszustände
- Brandings / Dokumentenvorlagen
- Preiserhöhungsschreiben
- Kundenreaktionen auf kommerzielle Dokumente

Die Plattform unterscheidet fachlich zwischen aktuellem Arbeitsstand, aktuell gültigem freigegebenem Stand und historischem Stand.

## 15. Preiserhöhungsschreiben als eigener Vorgang

Ein Preiserhöhungsschreiben ist ein strukturierter Vorgang mit Bezug auf Kunde, Vertrag, Preispositionen oder Leistungsgruppen, Begründungslogik, Gültigkeitsdatum, Fristen, Freigaben, Dokumentenversion, Zustellstatus, Kundenreaktion und Folgeschritten.

## 16. Ablehnungen und Gegenvorschläge des Kunden

Kundenreaktionen sollen strukturiert erfasst werden können, z. B. vollständig angenommen, teilweise angenommen, abgelehnt, Gegenvorschlag unterbreitet, Rückfrage gestellt, rechtliche Änderung gewünscht, preisliche Änderung gewünscht oder Laufzeitänderung gewünscht. Ein Gegenvorschlag soll zu einem klar verknüpften neuen Verhandlungsstand führen.

## 17. Vertragserstellung mit Bausteinen und Varianten

Jeder Vertragsbaustein gehört zu einer Klauselfamilie und kann mehrere Varianten besitzen, z. B. zart, moderat, standard, streng oder hart. Dadurch können Vertragsgenerierung, Verhandlung, Risikobewertung und Freigaben deutlich intelligenter und strukturierter erfolgen.

## 18. AI Copilot integriert und orchestrierend

Der AI Copilot ist kein reines Chatfenster, sondern eine prozessintegrierte, orchestrierende Schicht. Er erkennt Zusammenhänge zwischen Deal-Situation, Preislogik, Genehmigungsbedarf, Vertragsklauseln, Verhandlungsverlauf, Kundenreaktionen, Fristen, Risiken und offenen Aufgaben.

Beispiele:
- erkennt neue Preisfreigaben nach einem Gegenvorschlag
- schlägt Texte für Preiserhöhungsschreiben vor
- vergleicht Vertragsvarianten mit Standardpositionen
- priorisiert Freigaben nach Umsatzpotenzial und Frist
- erstellt zielgruppenspezifische Zusammenfassungen für Management, Legal oder Finance

## 19. Sales-Messbarkeit und Erfolgssteuerung

Gemessen werden sollten u. a.:
- Win Rate
- Quote-to-Close-Zeit
- Zeit bis zur ersten Angebotsversion
- Genehmigungsquote und Genehmigungsdauer
- durchschnittlicher Rabatt
- Margendisziplin
- Anteil Sonderklauseln
- Rate angenommener Angebote
- Erfolg von Preiserhöhungsschreiben
- Forecast-Qualität
- saubere Übergaben an Delivery oder Onboarding

KPIs sollten kontextualisiert werden nach Deal-Größe, Komplexität, Brand, Firma, Deal-Typ, Neukunde vs. Bestandskunde, Region, Anzahl nötiger Freigaben und vertraglicher Komplexität.

## 20. DSGVO / GDPR als Grundvoraussetzung

Wichtige Prinzipien sind Datenminimierung, Zweckbindung, rollenbasierter Zugriff, Lösch- und Aufbewahrungslogik, Mandantentrennung, Exportierbarkeit, Protokollierung sensibler Zugriffe, Trennung von Produktiv-, Test- und Demo-Daten sowie klare Einbettung der KI in das Datenschutzmodell.

## 21. API- und Integrationsstrategie

DealFlow One besitzt eine Commercial Integration Layer mit:
- kontextfähigen Abfragen
- ereignisgesteuerter Kommunikation
- Rückkanal für externe Systeme

Technisch herausragend wird die API durch versionierte Strategie, tenant-sichere Autorisierung, scope-basierte Berechtigung, idempotente Integrationslogik, zeitbezogene Fachabfragen, Ereignisfähigkeit, klare Trennung von operativen und analytischen Zugriffen sowie Auskunft über Datenherkunft und Gültigkeit.

## 22. Freigaben und Governance

Freigaben können ausgelöst werden durch Rabatte, Margenunterschreitung, Vertragsabweichungen, ungewöhnliche Klauselvarianten, Brand-spezifische Sonderregeln, Preisänderungen, Preiserhöhungsschreiben, kundenseitige Gegenvorschläge sowie Laufzeit- oder Kündigungsabweichungen.

## 23. Angebote als gesteuerte Objekte

Ein Angebot ist kein bloßes Dokument, sondern ein fachlich gesteuertes Objekt mit Zustand, Gültigkeit und Beziehung zu Preislogik, Vertrag und Kundenverhalten. Es unterstützt mehrere Versionen, klare Kennzeichnung des aktuell gültigen Stands, Annahme oder Ablehnung je Version, Gegenvorschlag als strukturierter Folgezustand, Bezug zu Freigaben, Vertragslogik, Preispositionen, Ablaufdatum und Dokumenthistorie.

## 24. Vertragswesen tief integriert

Das Vertragsmodul umfasst Vertragsfamilien, Bausteinbibliotheken, Variantenlogik pro Baustein, Standard- und Eskalationslogik, Freigaben bei Abweichungen, Verknüpfung mit Deal, Angebot und Preisänderungen, Versionierung, Redlining, strukturierte Gegenvorschläge, Signaturverfolgung, Nachträge / Amendments sowie Preiserhöhungsschreiben als möglicher vertraglicher Folgeprozess.

## 25. Kommunikations- und Verhandlungsebene

Wichtige kommunikative Vorgänge sind Angebotsversand, Vertragsversand, Reminder, Preiserhöhungsschreiben, Kundenreaktionen, Gegenvorschläge, Ablehnungen, Annahmebestätigungen, interne Eskalationen und AI-generierte Zusammenfassungen. Kommunikation wird damit nicht nur gespeichert, sondern prozesslogisch nutzbar.

## 26. Plattform für kommerzielle Zustände

DealFlow One verwaltet nicht nur Objekte, sondern kommerzielle Zustände, z. B. Deal offen, Angebot erstellt, Angebot freigegeben, Angebot beim Kunden, Angebot angenommen, Angebot abgelehnt, Gegenvorschlag aktiv, Vertrag in Prüfung, Vertrag intern freigegeben, Vertrag signiert, Auftragsbestätigung gesendet, Preiserhöhung angekündigt, Preiserhöhung akzeptiert oder Preiserhöhung abgelehnt.

## 27. Sicherheits- und Governance-Ebene

Neben DSGVO braucht DealFlow One Audit Trail, Zugriffshistorie, nachvollziehbare Änderungen, Versionen, Freigabeprotokolle, Dokumentenherkunft, scope-basierte Sichtbarkeit, Mandantentrennung, sichere Admin-Operationen und Schutz sensibler Felder.

## 28. Tenant Admin Console

Die Tenant Admin Console enthält mindestens:
- Firmenverwaltung im Mandanten
- Brand- / Branding-Verwaltung je Firma
- Benutzer und Teams
- Rollen und Scope-Zuweisungen
- Preisregeln und Preispositionen
- Angebotsvorlagen
- Vertragsbausteine und Varianten
- Freigabe-Policies
- API- und Integrationsverwaltung
- Datenschutz- und Exportoptionen
- Reporting-Konfigurationen

## 29. Plattformstrategie für Zukunftssicherheit

Die Architektur soll so angelegt sein, dass neue Firmen und Brands im bestehenden Mandanten leicht ergänzt werden können, neue Vertragsbausteine ohne Systemumbau entstehen, neue Preislogiken je Firma oder Brand konfigurierbar bleiben, neue AI-Orchestrierungsmodi ergänzbar sind und Integrationen ohne Kernumbau angeschlossen werden können.

## 30. Schlussfazit

DealFlow One ist in dieser erweiterten Form eine moderne, deal-zentrierte Commercial Operating Platform, die die Realität anspruchsvoller B2B-Organisationen wesentlich besser abbildet als klassische Einzeltools. Die Plattform ist einfach in der Nutzung, mächtig in der Tiefe, präzise in der Governance, flexibel in der Organisationsstruktur, stark in der Integration, sauber in Datenschutz und Nachvollziehbarkeit und intelligent genug, um Prozesse aktiv zu orchestrieren.
