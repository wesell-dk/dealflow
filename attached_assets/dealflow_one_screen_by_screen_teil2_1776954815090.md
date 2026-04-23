# DealFlow One
## Screen-by-Screen-Konzept – Teil 2
## Restliche Screens, ausführlich und detailliert beschrieben

## Einordnung

Dieses Dokument setzt das bereits begonnene Screen-by-Screen-Konzept für **DealFlow One** fort und beschreibt die **restlichen Kernscreens** der Plattform deutlich ausführlicher und operativ näher.

Der Fokus liegt dabei auf jenen Bereichen, die aus dem Kernprozess nach dem Deal Room, Quote Studio, Pricing Workspace, Approval Hub, Contract Workspace und Tenant Admin Console folgen oder diese ergänzen. Es handelt sich also um die Screens, in denen Verhandlung, Unterschrift, Abschluss, Preisänderungen, Steuerung, AI-Orchestrierung und Plattformbetrieb sichtbar und nutzbar werden.

Behandelt werden in diesem Dokument:

1. **Negotiation & Counterproposal Workspace**
2. **Signature Center**
3. **Order Confirmation & Handover Center**
4. **Price Increase Center**
5. **Reports & Performance Cockpit**
6. **AI Copilot Workspace**
7. **Platform Admin Console**
8. **Zusätzliche Querschnittsprinzipien und End-to-End Screen-Flows**

Wichtig ist: Jeder dieser Screens wird nicht nur als Oberfläche beschrieben, sondern als **operativer Arbeitsraum mit klarer fachlicher Aufgabe**. Ziel ist, dass Produktmanagement, UX, Engineering, Commercial Operations, Legal und Management aus dieser Beschreibung nachvollziehen können, **warum der Screen existiert**, **welche Entscheidungen dort getroffen werden**, **welche Informationen er sichtbar machen muss** und **wie er mit den anderen Screens zusammenspielt**.

---

# 1. Negotiation & Counterproposal Workspace

## 1.1 Strategische Rolle des Screens

Der Negotiation & Counterproposal Workspace ist einer der wichtigsten Differenzierungsbausteine von DealFlow One. Viele Systeme behandeln Verhandlung nur als lose Folge von E-Mails, Kommentaren oder Dateiversionen. Dadurch geht der Überblick verloren, was genau der Kunde eigentlich verändert haben möchte, welche Version dadurch betroffen ist, welche Freigaben erneut nötig werden und welche Konsequenzen das auf Preis, Marge, Risiko, Vertragslage und Abschlusswahrscheinlichkeit hat.

DealFlow One soll dieses Problem lösen, indem Verhandlung nicht als Nebenkommunikation, sondern als **strukturierter kommerzieller Entscheidungsraum** modelliert wird.

Der Screen muss deshalb nicht nur Nachrichten anzeigen, sondern den Nutzer in die Lage versetzen, folgende Fragen sehr schnell zu beantworten:

- Was genau hat der Kunde akzeptiert, abgelehnt oder infrage gestellt?
- Betrifft die Rückmeldung Preis, Laufzeit, Leistungsumfang, Vertragstext oder mehrere Themen gleichzeitig?
- Bezieht sich die Rückmeldung auf eine konkrete Angebotsversion, Vertragsversion oder einen früheren Verhandlungsstand?
- Muss daraus eine neue Angebotsversion, eine Vertragsänderung, ein Amendment oder eine neue Freigabe entstehen?
- Welche Reaktion ist fachlich und wirtschaftlich sinnvoll?
- Welche Risiken, Eskalationen oder Policy-Abweichungen löst der Gegenvorschlag aus?

## 1.2 Primäre Nutzergruppen

Der Screen ist besonders relevant für:

- Sales Reps
- Account Executives
- Sales Manager
- Commercial Operations / RevOps
- Legal Reviewer
- gegebenenfalls Finance Approver
- in Sonderfällen Executive Entscheider

Je nach Rolle sieht derselbe Screen unterschiedlich aus. Sales wird vor allem an der schnellen Einordnung, Reaktion und Folgeversion interessiert sein. Legal wird auf Klauseländerungen, Governance und Risikobewertung fokussieren. RevOps interessiert sich zusätzlich für Margen, Freigaben und formale Konsistenz.

## 1.3 Kernzweck des Screens

Der Screen ist der Ort, an dem **eingehende Kundenreaktionen in strukturierte nächste kommerzielle Schritte übersetzt werden**.

Er hat damit vier Hauptaufgaben:

1. Kundenreaktionen sichtbar und strukturiert machen
2. Auswirkungen auf Angebot, Vertrag und Preislogik erkennen
3. notwendige Folgeaktionen orchestrieren
4. den Verhandlungsverlauf historisch und analytisch nachvollziehbar halten

## 1.4 Typische Einstiegsfragen eines Nutzers

Wenn ein Nutzer diesen Screen öffnet, muss er innerhalb weniger Sekunden verstehen:

- Worum geht es genau in dieser Verhandlung?
- Was war der letzte Stand, den der Kunde erhalten hat?
- Was genau kam zurück?
- Wie kritisch ist die Änderung?
- Wer muss jetzt handeln?
- Welche Optionen stehen offen?

## 1.5 Grundlayout des Screens

Der Screen sollte in fünf logische Bereiche gegliedert sein.

### Bereich A: Verhandlungsheader

Dieser Bereich fasst den Fall auf oberster Ebene zusammen:

- Dealname
- Kunde / Account
- aktueller kommerzieller Status
- betroffene Angebotsversion
- betroffene Vertragsversion
- Firma
- Brand
- Owner
- aktueller Verhandlungsstatus
- Priorität
- Risikoeinstufung

Der Header dient der schnellen Kontextorientierung und muss sehr klar lesbar sein.

### Bereich B: Chronologische Negotiation Timeline

Hier sieht der Nutzer den Verhandlungsverlauf als strukturierte Zeitachse, nicht bloß als ungeordnete Nachrichtenliste.

Darstellbar sein sollten zum Beispiel:

- ursprüngliches Angebot versendet
- Kunde geöffnet
- Kunde hat Rückfrage gestellt
- Kunde fordert Preisnachlass
- neue Angebotsversion erstellt
- Legal Review gestartet
- Gegenvorschlag versendet
- Kunde akzeptiert teilweise
- Vertragsklausel geändert
- Signatur angestoßen

Die Timeline ist essenziell, damit alle Beteiligten denselben Wissensstand haben.

### Bereich C: Strukturierte Kundenreaktion

Dieser Bereich bildet die aktuell zu bearbeitende Rückmeldung in fachlich strukturierter Form ab.

Dort sollte sichtbar sein:

- Reaktionstyp
- Bezugsobjekt, zum Beispiel Angebotsversion oder Vertragsversion
- betroffene Themenbereiche
- Priorität / Dringlichkeit
- gewünschte Änderung
- mögliche Frist oder Deadline des Kunden
- Quelle der Information, etwa E-Mail, Call-Note, Meeting-Protokoll, Portal-Rückmeldung

### Bereich D: Impact- und Entscheidungsbereich

Das ist der fachlich wichtigste Teil des Screens. Hier zeigt DealFlow One, was die Kundenreaktion auslöst.

Der Bereich sollte erkennbar machen:

- Preisänderung nötig oder nicht
- neue Angebotsversion nötig oder nicht
- Vertragsänderung nötig oder nicht
- neue Freigabe nötig oder nicht
- Risiko steigt oder sinkt
- Marge verändert sich oder nicht
- Abschlusswahrscheinlichkeit verändert sich
- Folgeobjekte, die aktualisiert werden müssen

### Bereich E: Aktions- und Entscheidungsleiste

Hier werden die nächsten sinnvollen Schritte als konkrete Aktionen angeboten.

Beispiele:

- neue Angebotsversion anlegen
- Preisupdate übernehmen
- Klauselvariante wechseln
- Legal Review starten
- Genehmigung anfordern
- Gegenvorschlag dokumentieren
- Antwort an Kunden vorbereiten
- Verhandlungsrunde schließen
- Deal eskalieren

## 1.6 Fachliche Datenbausteine auf dem Screen

Damit der Screen sauber funktioniert, sollte er auf strukturierte Fachobjekte zugreifen, etwa:

- Deal
- Angebotsversion
- Vertragsversion
- Kundenreaktion
- Verhandlungsrunde
- Gegenvorschlag
- Preispositionsänderung
- Klauseländerung
- Freigabefall
- AI-Zusammenfassung
- Aufgaben / Owner

Der Nutzer muss diese Objekte nicht technisch sehen, aber die Oberfläche sollte aus genau diesen Bedeutungen gespeist werden.

## 1.7 Darstellung von Reaktionstypen

Die Plattform sollte klare, visuell leicht erfassbare Reaktionsarten unterscheiden. Zum Beispiel:

- vollständig angenommen
- teilweise angenommen
- Preis abgelehnt
- Vertragsklausel abgelehnt
- Laufzeitänderung gewünscht
- Leistungsumfang angepasst
- Gegenvorschlag eingereicht
- Prüfung intern beim Kunden
- Entscheidung vertagt

Diese Klassifikation ist nicht nur für die UI wichtig, sondern auch für Reporting, Prozessdauer, Erfolgsanalyse und AI-Unterstützung.

## 1.8 Wie Gegenvorschläge dargestellt werden sollten

Ein Gegenvorschlag sollte als strukturierter Änderungsblock visualisiert werden. Dieser Block könnte zeigen:

- Ursprungsversion
- gewünschte Änderung
- wirtschaftliche Auswirkung
- vertragliche Auswirkung
- Freigabebedarf
- empfohlene Reaktion

Beispielhaft könnte ein Gegenvorschlag in mehrere Teilblöcke zerfallen:

- Preis: minus 7 Prozent statt minus 3 Prozent
- Laufzeit: 36 statt 24 Monate
- Zahlungsziel: 60 statt 30 Tage
- Haftung: weichere Variante gewünscht

So erkennt der Nutzer schnell, welche Themen gleichzeitig verhandelt werden.

## 1.9 AI-Unterstützung im Negotiation Screen

Der AI Copilot sollte in diesem Screen eine aktive, aber kontrollierte Rolle spielen. Sinnvolle Funktionen wären:

- Zusammenfassung der letzten Verhandlungsrunde
- Extraktion zentraler Änderungswünsche aus eingehender Kommunikation
- Erkennung, ob Preis-, Vertrags- oder Mischthemen betroffen sind
- Einschätzung, welche Freigaben nötig werden könnten
- Vorschlag für nächste Schritte
- Entwurf einer internen oder externen Antwort
- Risiko-Highlighting bei ungewöhnlichen Kombinationen

Wichtig ist, dass AI nicht autonom verbindliche Änderungen durchführt, sondern dem Nutzer strukturierte Entscheidungsunterstützung liefert.

## 1.10 Zustände des Screens

Der Screen sollte sauber mit Verhandlungszuständen arbeiten, zum Beispiel:

- neue Reaktion eingegangen
- in Analyse
- interne Abstimmung läuft
- neue Version in Vorbereitung
- Gegenvorschlag versendet
- auf Kundenantwort wartend
- Verhandlung abgeschlossen
- Verhandlung eskaliert
- Deal gefährdet

Diese Zustände helfen Nutzern und Management, Verhandlung nicht als Black Box wahrzunehmen.

## 1.11 Wichtige Aktionen

Wesentliche Nutzeraktionen auf diesem Screen sind:

- Kundenreaktion erfassen
- bestehende Reaktion klassifizieren
- betroffene Angebots- oder Vertragsversion verknüpfen
- neue Runde starten
- neue Angebotsversion anlegen
- neue Vertragsversion anlegen
- Genehmigung auslösen
- Sales Manager oder Legal einbeziehen
- Deal-Risiko anpassen
- Reaktion als beantwortet markieren
- Verhandlung formal schließen

## 1.12 Besondere UX-Anforderungen

Die größte UX-Herausforderung besteht darin, Komplexität beherrschbar zu machen, ohne wichtige Informationen zu verstecken.

Deshalb sollte der Screen nach dem Prinzip arbeiten:

- oben Zusammenfassung
- in der Mitte strukturierte Verhandlung
- rechts oder sekundär tiefe Detail- und Impact-Informationen
- klare Hervorhebung des nächsten sinnvollen Schritts

## 1.13 KPI- und Reporting-Bezug

Dieser Screen speist zentrale Kennzahlen, etwa:

- Anzahl Verhandlungsrunden pro Deal
- durchschnittliche Dauer je Verhandlungsthema
- häufigste Ablehnungsgründe
- häufigste Klauselabweichungen
- durchschnittlicher Preisnachlass nach Gegenangebot
- Einfluss bestimmter Verhandlungsmuster auf Win Rate

## 1.14 Typischer End-to-End-Flow

Ein typischer Ablauf könnte so aussehen:

1. Kunde erhält Angebot und Vertrag
2. Kunde lehnt zwei Preispositionen und eine Klauselvariante ab
3. Sales erfasst oder bestätigt die Kundenreaktion
4. Der Screen zeigt: Preisänderung + Vertragsänderung + neue Freigaben nötig
5. Sales startet neue Angebotsversion
6. Legal prüft Klauselvariante
7. Finance genehmigt geänderte Konditionen
8. Neuer Gegenvorschlag wird versendet
9. Kunde akzeptiert
10. Deal springt weiter in Richtung Signatur und Abschluss

---

# 2. Signature Center

## 2.1 Strategische Rolle des Screens

Das Signature Center ist der Ort, an dem aus einem intern freigegebenen kommerziellen Zustand ein formal verbindlicher Abschluss wird. Viele Systeme behandeln Signaturen wie einen technischen Nebenprozess. In DealFlow One muss die Signatur dagegen als **sichtbarer, steuerbarer Abschlusszustand** verstanden werden.

Der Screen ist damit nicht nur eine Liste gesendeter Signaturanfragen, sondern ein **Steuerungsraum für Verbindlichkeit, Reihenfolge, Statusklarheit und Abschlussreife**.

## 2.2 Hauptziele des Screens

Der Screen muss folgende Fragen beantworten:

- Welche Dokumente warten auf Unterschrift?
- Wer muss unterschreiben?
- In welcher Reihenfolge?
- Wo hängt ein Signaturprozess?
- Welche Verträge oder Angebotsdokumente sind bereits teilweise oder vollständig signiert?
- Welche Folgeaktion ist nach erfolgreicher Signatur nötig?

## 2.3 Primäre Nutzergruppen

- Sales
- Sales Operations
- Legal
- Customer Success / Onboarding
- Management bei größeren oder kritischen Deals
- gegebenenfalls Finance

## 2.4 Grundlayout des Screens

### Bereich A: Signaturübersicht

Listen- oder Kachelansicht aller laufenden und abgeschlossenen Signaturfälle mit Filtern nach:

- Status
- Firma
- Brand
- Deal
- Kunde
- Dokumenttyp
- verantwortlichem Owner
- Fälligkeit / Deadline

### Bereich B: Signaturdetailansicht

Dieser Bereich zeigt den ausgewählten Signaturfall im Detail:

- zugehöriger Deal
- zugehöriges Angebot / Vertrag / Amendment
- aktuelle Version des Dokuments
- Status des Signaturpakets
- Unterzeichnerliste
- Reihenfolge der Signatur
- Versandzeitpunkt
- letzte Aktivität
- Abschlussnachweis

### Bereich C: Unterzeichner-Workflow

Eine visuell klare Darstellung, welche Parteien unterschreiben müssen und in welchem Status sie sich befinden:

- noch nicht eingeladen
- eingeladen
- geöffnet
- signiert
- erinnert
- abgelaufen
- abgelehnt / verweigert

### Bereich D: Folgeaktionspanel

Hier sieht der Nutzer, was nach erfolgreicher oder blockierter Signatur zu tun ist:

- Reminder senden
- Unterzeichner austauschen
- Signaturreihenfolge ändern, falls zulässig
- Signaturprozess neu starten
- Dokument erneut generieren, falls Version veraltet ist
- Abschluss an Order Confirmation übergeben

## 2.5 Wichtige Informationsbausteine

Der Screen muss immer klar trennen zwischen:

- Dokument ist intern freigegeben
- Dokument ist zur Signatur versendet
- mindestens eine Signatur liegt vor
- alle erforderlichen Signaturen liegen vor
- Signatur ist formal abgeschlossen
- Folgeprozess wurde oder wurde noch nicht angestoßen

Diese Zustände dürfen nicht vermischt werden, weil sonst operative Unsicherheit entsteht.

## 2.6 Statuslogik

Sinnvolle Signaturzustände sind zum Beispiel:

- vorbereitet
- versandbereit
- versendet
- geöffnet
- teilweise signiert
- vollständig signiert
- abgelaufen
- abgebrochen
- ersetzt durch neue Version
- Abschluss bestätigt

## 2.7 Unterzeichnerlogik

Der Screen muss die Unterzeichnerseite sehr sauber abbilden. Wichtig sind insbesondere:

- Rolle des Unterzeichners
- interne oder externe Partei
- Signaturreihenfolge
- verpflichtende oder optionale Unterschrift
- Delegation / Vertretung
- Signaturdatum
- offene Hürde, falls jemand blockiert

## 2.8 Verbindung zum Vertrags- und Angebotsstatus

Ein besonderer Mehrwert entsteht, wenn der Nutzer nicht nur den Signaturstatus sieht, sondern gleichzeitig den kommerziellen Kontext:

- zu welchem Vertragsstand gehört diese Signatur?
- wurde das Dokument nach Versand bereits geändert?
- ist eine Signatur auf einer alten Version erfolgt?
- ist nach Signatur automatisch eine Auftragsbestätigung vorgesehen?

Diese Verknüpfung schützt vor Prozessfehlern.

## 2.9 AI-Unterstützung im Signature Center

Der AI Copilot kann hier eher unterstützend als entscheidend arbeiten, etwa durch:

- Identifikation blockierter Signaturfälle
- Formulierung von Reminder-Vorschlägen
- Zusammenfassung, warum ein Signaturfall stockt
- Hinweise, ob die nächste sinnvolle Aktion Eskalation, Erinnerung oder Re-Generation des Dokuments ist

## 2.10 Typische Aktionen

Wesentliche Aktionen auf dem Screen:

- Signatur starten
- Unterzeichner prüfen oder ändern
- Reminder senden
- Frist verlängern
- Signatur abbrechen
- neue Version zur Signatur stellen
- Abschlussnachweis öffnen
- Folgeprozess starten

## 2.11 KPI-Sicht des Screens

Mögliche Kennzahlen:

- durchschnittliche Signaturdauer
- Anteil der Signaturfälle mit Reminder
- Anteil der Fälle mit Unterzeichnerwechsel
- Zeit von Vertragsfreigabe bis Vollsignatur
- Anteil digital vollständig abgeschlossener Deals

## 2.12 Besondere UX-Anforderung

Der Screen muss ruhig und absolut statusklar sein. Signatur ist ein sensibler Moment. Die Oberfläche sollte deshalb weniger „arbeitslastig“ und stärker **verbindlichkeitsorientiert** wirken.

---

# 3. Order Confirmation & Handover Center

## 3.1 Strategische Rolle des Screens

Mit diesem Screen wird aus kommerzieller Einigung ein operativ übergabefähiger Zustand. Das ist ein kritischer Schritt, der in vielen Unternehmen zwischen Sales, Operations, Customer Success, Projektteams oder ERP-gestützten Folgeprozessen verloren geht.

DealFlow One sollte genau hier stark sein: Nicht nur Abschluss erfassen, sondern **sauber und kontrolliert in den Folgeprozess überführen**.

## 3.2 Hauptzweck des Screens

Der Screen soll sicherstellen, dass nach Annahme oder Signatur keine operative Lücke entsteht.

Er beantwortet:

- Ist der Deal kommerziell vollständig abgeschlossen?
- Liegt das maßgebliche angenommene Angebot vor?
- Ist der Vertrag vollständig signiert oder reicht die Angebotsannahme?
- Wurde bereits eine Auftragsbestätigung erstellt?
- Sind alle Pflichtinformationen für die Übergabe vollständig?
- Wurde die Übergabe an das Folgesystem oder das Delivery-Team ausgelöst?

## 3.3 Primäre Nutzergruppen

- Sales Operations
- Customer Success / Onboarding
- Project / Delivery Handover Teams
- gegebenenfalls Finance oder ERP-nahe Rollen
- Sales Manager zur Qualitätssicherung

## 3.4 Grundlayout

### Bereich A: Handover Queue

Liste aller Fälle, die auf Auftragsbestätigung oder Übergabe warten. Filterbar nach:

- Status
- Firma
- Brand
- Kunde
- Deal Owner
- Abschlussdatum
- Übergabereife
- fehlenden Informationen

### Bereich B: Detailansicht des Handover Falls

Zeigt den einzelnen Fall mit:

- Dealzusammenfassung
- maßgeblicher Angebotsstand
- Vertragsstatus
- Signaturstatus
- Auftragsbestätigungsstatus
- Handover Readiness Check
- Folgeempfänger oder Zielsystem

### Bereich C: Readiness Check

Sehr wichtig ist ein Checklisten- oder Gate-Modell, das sichtbar macht:

- Angebot angenommen
- Vertrag signiert, falls erforderlich
- Pflichtfelder vollständig
- Preis- und Leistungsumfang final
- Kunde bestätigt
- Ansprechpartner für Umsetzung gesetzt
- Folgeprozess-Ziel definiert

### Bereich D: Übergabe- und Bestätigungsbereich

Hier werden die eigentlichen Schritte ausgelöst:

- Auftragsbestätigung generieren
- Auftragsbestätigung freigeben
- Auftragsbestätigung versenden
- an Delivery / Customer Success übergeben
- an ERP / Billing übergeben
- Handover abgeschlossen markieren

## 3.5 Zentrale Designidee

Dieser Screen sollte sich wie ein **Commercial Completion Workspace** anfühlen, nicht wie ein Dateipostfach. Er muss klar machen, dass jetzt aus „gewonnenem Deal“ ein belastbarer operativer Start wird.

## 3.6 Auftragsbestätigung als eigener Status

Ein wichtiger Punkt in DealFlow One ist, dass die Auftragsbestätigung nicht nur als Dokument verstanden wird, sondern als fachlicher Zustand.

Die Plattform sollte unterscheiden können zwischen:

- Auftragsbestätigung noch nicht erstellt
- erstellt, aber intern nicht freigegeben
- freigegeben
- versendet
- vom Kunden bestätigt oder zur Kenntnis genommen, falls relevant
- an Folgeprozess übergeben

## 3.7 Handover Readiness Score

Ein starker UX- und Produktbaustein wäre ein sichtbarer Readiness Score oder Readiness Status, der zum Beispiel anzeigt:

- grün: vollständig übergabefähig
- gelb: kleinere Informationen fehlen
- rot: Übergabe fachlich noch nicht zulässig

Damit versteht auch ein nicht tief eingearbeiteter Nutzer sofort, wie vollständig der Abschlussprozess wirklich ist.

## 3.8 AI-Unterstützung im Handover Center

Sinnvolle AI-Funktionen:

- Zusammenfassung des finalen kommerziellen Stands für Delivery oder Onboarding
- Erkennung fehlender Informationen vor Übergabe
- Vorschlag einer Handover-Zusammenfassung
- Hinweise auf Widersprüche zwischen Angebot, Vertrag und Auftragsbestätigung

## 3.9 Typische Aktionen

- Auftragsbestätigung erzeugen
- fehlende Pflichtinformationen nachpflegen
- Kunden- und Ansprechpartnerdaten prüfen
- Handover-Zusammenfassung erzeugen
- Übergabe an Folgeprozess auslösen
- Fall als abgeschlossen markieren

## 3.10 KPI-Sicht des Screens

Wichtige Kennzahlen:

- Zeit vom Abschluss bis zur Auftragsbestätigung
- Zeit vom Abschluss bis zum Handover
- Anteil unvollständiger Übergaben
- Anzahl Reworks nach Handover
- häufigste fehlende Pflichtinformationen

---

# 4. Price Increase Center

## 4.1 Strategische Rolle des Screens

Das Price Increase Center ist ein außergewöhnlich starker Bestandteil von DealFlow One, weil es einen häufig vernachlässigten, aber geschäftlich hochrelevanten Prozess strukturiert: Preiserhöhungen im Bestandskundengeschäft.

Statt Preiserhöhungsschreiben in E-Mail-Listen, Word-Dokumenten oder Einzelfallprozessen zu verstecken, soll DealFlow One sie als **steuerbare kommerzielle Fälle** behandeln.

## 4.2 Warum dieser Screen wichtig ist

Preiserhöhungen sind selten rein operative Kommunikation. Sie sind meist ein sensibler Mix aus:

- Preislogik
- Vertragsbezug
- Kundenbeziehung
- Verhandlung
- rechtlicher Zulässigkeit
- Freigabe
- Umsatzsicherung
- Kündigungsrisiko

Genau deshalb braucht dieser Prozess einen eigenen Screen.

## 4.3 Hauptziele des Screens

Der Screen soll ermöglichen:

- Preiserhöhungsfälle strukturiert vorzubereiten
- betroffene Preispositionen und Verträge transparent zu sehen
- Schreiben kontrolliert zu erstellen und zu versenden
- Kundenreaktionen sauber zu erfassen
- Folgeaktionen bei Annahme, Ablehnung oder Gegenvorschlag auszulösen
- Revenue-Risiken messbar zu machen

## 4.4 Primäre Nutzergruppen

- Customer Success / Account Management
- Sales bei Bestandskunden
- Commercial Ops / RevOps
- Finance
- Legal bei kritischen Fällen
- Management für strategische Steuerung

## 4.5 Grundlayout

### Bereich A: Fallübersicht

Eine Liste oder Kachelansicht aller Preiserhöhungsfälle mit Filtern nach:

- Status
- Kunde
- Firma
- Brand
- Wirksamkeitsdatum
- Risikostufe
- Reaktionsstatus
- Owner
- Vertragsbezug

### Bereich B: Fallheader

- Kunde / Account
- betroffener Vertrag oder Vertragsfamilie
- betroffene Preispositionen oder Leistungen
- aktueller Preis
- geplanter neuer Preis
- Erhöhungsdatum
- Begründungskategorie
- Risikoeinschätzung

### Bereich C: Preis- und Vertragsbezug

Der Nutzer muss klar erkennen:

- welche Preispositionen betroffen sind
- ob der aktuelle Vertrag diese Erhöhung stützt
- ob Klauseln zur Preisanpassung vorhanden sind
- ob ein Amendment nötig werden könnte
- ob unterschiedliche Firmen- oder Brand-Kontexte relevant sind

### Bereich D: Kommunikations- und Dokumentenbereich

Hier wird das eigentliche Preiserhöhungsschreiben vorbereitet und verwaltet:

- Vorlage
- Textbausteine
- Begründung
- Wirksamkeitsdatum
- Sprache / Brand-Kommunikation
- Versandhistorie

### Bereich E: Reaktions- und Maßnahmenbereich

Nach Versand muss der Screen den Nutzer durch den Folgeprozess führen:

- Kunde akzeptiert
- Kunde lehnt ab
- Kunde macht Gegenvorschlag
- Kunde bittet um Aufschub
- Eskalation an Management oder Legal nötig
- Vertragsänderung / Amendment nötig

## 4.6 Fachliche Unterteilung des Falls

Ein Preiserhöhungsfall sollte im Screen mindestens in diese Ebenen gegliedert sein:

- wirtschaftliche Änderung
- vertragliche Grundlage
- Kommunikationsschritt
- Kundenreaktion
- Folgeentscheidung

Das hilft, unterschiedliche Aspekte sauber auseinanderzuhalten.

## 4.7 Statusmodell

Sinnvolle Zustände könnten sein:

- in Vorbereitung
- intern in Prüfung
- freigegeben
- versendet
- Kunde informiert
- Reaktion eingegangen
- akzeptiert
- abgelehnt
- in Verhandlung
- Amendment nötig
- abgeschlossen
- verloren / gekündigt

## 4.8 AI-Unterstützung im Price Increase Center

Sehr nützliche AI-Funktionen wären:

- Zusammenfassung wirtschaftlicher Wirkung
- Erkennung betroffener Vertragsklauseln
- Risikoeinschätzung der Kundenreaktion
- Vorschläge zur Formulierung von Antwortschreiben
- Clusterung ähnlicher Einwände über mehrere Kunden hinweg
- Zusammenfassung des erwarteten Umsatz- oder Churn-Risikos

## 4.9 Typische Aktionen

- Preiserhöhungsfall anlegen
- Preispositionen zuordnen
- Begründung auswählen oder formulieren
- Preiserhöhungsschreiben generieren
- Freigabe starten
- Schreiben versenden
- Kundenreaktion erfassen
- Gegenvorschlag in Negotiation Workspace weitergeben
- Amendment anstoßen
- Fall abschließen

## 4.10 KPI-Sicht des Screens

Zentrale Kennzahlen:

- Erfolgsquote von Preiserhöhungen
- Umsatzwirkung geplanter und angenommener Erhöhungen
- Ablehnungsquote nach Kundensegment
- durchschnittliche Reaktionsdauer
- Häufigkeit von Gegenvorschlägen
- Zusammenhang zwischen Erhöhungshöhe und Akzeptanzrate
- Kündigungsrisiko infolge von Erhöhungen

## 4.11 Besondere UX-Anforderung

Der Screen muss sehr sensibel und professionell wirken. Preisänderungen sind beziehungsrelevant. Deshalb sollte die UI nicht wie ein Massenmail-Tool wirken, sondern wie ein **kommerzieller Steuerungsraum für wertschonende Umsatzanpassung**.

---

# 5. Reports & Performance Cockpit

## 5.1 Strategische Rolle des Screens

Das Reports & Performance Cockpit macht DealFlow One führungstauglich. Hier wird sichtbar, ob der kommerzielle Prozess wirklich wirkt, wo Reibung entsteht und wie Teams, Brands, Firmen oder Rollen performen.

Der Screen ist kein klassisches Reporting-Archiv, sondern ein **entscheidungsorientiertes Steuerungscockpit**.

## 5.2 Hauptziele des Screens

Der Screen soll:

- Vertriebsleistung messbar machen
- Prozessqualität sichtbar machen
- Unterschiede zwischen Firmen, Brands, Teams und Rollen erklären
- Risiken und Engpässe früh erkennbar machen
- Governance und Disziplin im Prozess messbar machen

## 5.3 Primäre Nutzergruppen

- Sales Manager
- Commercial Leadership
- Revenue Operations
- Geschäftsführung
- Tenant Admin, teilweise
- Finance / Strategy, je nach Rechteumfang

## 5.4 Grundlayout

### Bereich A: KPI-Header

Ein oberer Bereich mit wichtigsten Kennzahlen für den gewählten Zeitraum und Scope. Beispiele:

- Pipeline-Wert
- Win Rate
- Quote-to-Close
- durchschnittliche Angebotsdauer
- durchschnittliche Freigabedauer
- Signaturdauer
- Vertragsabweichungsquote
- Erfolgsquote von Preiserhöhungen

### Bereich B: Filter- und Perspektivenleiste

Filterbar nach:

- Zeitraum
- Mandant, sofern relevant für Plattformsicht
- Firma
- Brand
- Team
- Benutzer
- Deal-Typ
- Segment
- Region
- Produkt- oder Leistungsbereich

### Bereich C: Performance-Visualisierungen

Visualisierungen und Tabellen zu:

- Conversion entlang des Commercial Funnels
- Phase-Dauer
- Freigabe-Engpässen
- Verhandlungsintensität
- Margenentwicklung
- Angebotsversionen pro Deal
- Vertragsabweichungen
- Signatur- und Handover-Dauern

### Bereich D: Ursachen- und Abweichungsanalyse

Ein sehr wertvoller Bereich wäre die Darstellung von Ursachen hinter Leistungsunterschieden:

- Deals verlieren sich häufiger nach Legal Review
- bestimmte Brands erzeugen häufiger Sonderfreigaben
- bestimmte Teams brauchen länger bis zur Signatur
- bestimmte Klauselfamilien verlängern die Deal-Dauer
- starke Rabattierung verbessert Abschluss nicht proportional

### Bereich E: Export und Management Summary

- Management Summary generieren
- PDF / Export, falls berechtigt
- Drilldown in Detailfälle
- Link in konkrete Deals, Freigaben oder Preisfälle

## 5.5 KPI-Kategorien

Sinnvoll ist eine Gliederung in KPI-Familien.

### Vertriebs-KPIs

- Win Rate
- Deal Value
- Forecast Accuracy
- Quote-to-Close
- durchschnittlicher Deal-Zyklus

### Prozess-KPIs

- Zeit bis erstes Angebot
- Zeit bis Freigabe
- Zeit bis Vertrag freigegeben
- Zeit bis Vollsignatur
- Zeit bis Auftragsbestätigung

### Governance-KPIs

- Anzahl Sonderfreigaben
- Vertragsabweichungsquote
- Rabattabweichung vom Standard
- Policy-Verstoßquote

### Bestandskunden- und Preis-KPIs

- Erfolgsquote Preiserhöhungen
- Umsatzsicherung durch Preismaßnahmen
- Häufigkeit von Gegenangeboten
- Churn-Risiko bei Preisänderungen

### Verhandlungs-KPIs

- durchschnittliche Anzahl Verhandlungsrunden
- häufigste Ablehnungsgründe
- häufigste Klauselthemen
- Preisnachlass nach Erstangebot

## 5.6 Rolle von Benchmarks

Das Cockpit sollte nicht nur absolute Zahlen anzeigen, sondern Vergleichsdimensionen bieten:

- Team gegen Team
- Brand gegen Brand
- Firma gegen Firma
- Zeitraum gegen Vorperiode
- Segment gegen Segment

Damit wird Performance wirklich interpretierbar.

## 5.7 AI-Unterstützung im Reporting

Der AI Copilot kann hier besonders wirksam sein, etwa durch:

- Management-Zusammenfassungen in natürlicher Sprache
- Hervorhebung auffälliger Trends
- Erklärungen für KPI-Ausreißer
- Vorschläge, welche Prozessverbesserung den größten Effekt hätte
- automatische Zusammenfassung für Weekly Business Reviews

## 5.8 Typische Aktionen

- Zeitraum ändern
- Perspektive wechseln
- Drilldown in Team oder Brand
- KPI definieren / filtern
- Management Summary erzeugen
- Problemfall in Operative Screens öffnen
- Export starten, falls erlaubt

## 5.9 Besondere UX-Anforderungen

Das Cockpit darf nicht nur analytisch, sondern muss **steuernd** sein. Gute Reports führen zu Aktion. Schlechte Reports enden in Betrachtung ohne Konsequenz.

Deshalb sollte möglichst jede kritische Zahl einen Weg zurück in die operative Ursache öffnen.

---

# 6. AI Copilot Workspace

## 6.1 Strategische Rolle des Screens

Der AI Copilot Workspace ist nicht einfach ein Chatfenster. Er ist der Ort, an dem die integrierte KI von DealFlow One **orchestrierend, kontextbewusst und rollenorientiert** arbeitet.

Das ist entscheidend, weil die KI sonst nur als Zusatzfunktion wahrgenommen würde. In DealFlow One muss sie stattdessen als **Themensteuerer und Entscheidungsassistent** wirken.

## 6.2 Grundidee des Screens

Der Screen soll es ermöglichen, die KI nicht nur frei zu befragen, sondern in klaren Modi zu nutzen. Die KI soll dabei auf den fachlich erlaubten Kontext zugreifen und strukturierte Ergebnisse liefern.

## 6.3 Primäre Nutzergruppen

- Sales
- Sales Manager
- RevOps / Commercial Ops
- Legal
- Finance Approver
- Executive Stakeholder
- Tenant Admin in Spezialfällen

## 6.4 Kernziele des Screens

Der Screen soll:

- Kontext zusammenfassen
- Informationen über mehrere Objekte hinweg verbinden
- Risiken sichtbar machen
- nächste Schritte vorschlagen
- operative Arbeit beschleunigen
- Management-, Sales- oder Legal-gerechte Perspektiven liefern

## 6.5 Grundlayout

### Bereich A: Themen- und Modusauswahl

Der Nutzer startet nicht zwingend mit leerem Prompt, sondern kann aus klaren Themenmodi wählen:

- Deal Summary
- Negotiation Support
- Pricing Review
- Approval Readiness
- Contract Risk Review
- Renewal / Price Increase Support
- Executive Briefing
- Commercial Health Check

### Bereich B: Kontextpanel

Hier wird angezeigt, auf welchen fachlichen Kontext sich die KI gerade bezieht:

- aktueller Deal
- aktueller Kunde
- ausgewählte Angebotsversion
- Vertragsversion
- offener Freigabefall
- Preiserhöhungsfall
- Brand / Firma / Zeitraum

Das ist wichtig für Transparenz und Governance.

### Bereich C: Hauptarbeitsfläche

Die KI gibt hier keine bloßen Textmengen aus, sondern möglichst strukturierte Ergebnisse, zum Beispiel:

- Zusammenfassung
- Liste der offenen Risiken
- erkannte Widersprüche
- nächste empfohlene Schritte
- mögliche Formulierungen
- Vergleich von Versionen
- Entscheidungsoptionen

### Bereich D: Aktionspanel

Aus AI-Ergebnissen heraus sollten kontrollierte Folgeaktionen möglich sein, zum Beispiel:

- Aufgabe anlegen
- Freigabe vorbereiten
- neue Angebotsversion starten
- Vertragsreview öffnen
- Management Summary exportieren
- Antwortentwurf übernehmen

## 6.6 Die wichtigsten Themenmodi

### Deal Summary Mode

Verdichtet den Gesamtstand eines Deals für Sales, Manager oder Executives.

### Negotiation Support Mode

Analysiert Kundenreaktionen, Gegenvorschläge und sinnvolle Reaktionsoptionen.

### Pricing Review Mode

Erklärt Preisquellen, Preisänderungen, Policy-Abweichungen und Freigabebedarf.

### Approval Readiness Mode

Prüft, ob ein Fall entscheidungsreif ist und welche Informationen noch fehlen.

### Contract Risk Review Mode

Analysiert Klauselvarianten, Standardabweichungen, potenzielle Risiken und Freigabefolgen.

### Renewal / Price Increase Mode

Unterstützt bei Preisänderungen im Bestand und bewertet Kunden- und Umsatzrisiken.

### Executive Briefing Mode

Erzeugt managementtaugliche Kurzformate für Meetings, Entscheidungen und Statusberichte.

## 6.7 Zentrale Anforderungen an die KI-Oberfläche

Die KI muss jederzeit erkennbar machen:

- worauf sie sich bezieht
- welche Informationen sicher vorliegen
- was Interpretation oder Empfehlung ist
- welche Aktion der Nutzer übernehmen kann
- welche Inhalte wegen Rollen oder Scope nicht berücksichtigt werden dürfen

## 6.8 Governance und Rechte im AI Screen

Gerade dieser Screen muss streng rollen- und scope-sensibel sein. Die KI darf nicht versehentlich Daten zusammenfassen, die der Nutzer außerhalb seines zulässigen Bereichs nicht sehen dürfte.

Deshalb sollte der Screen an mehreren Stellen transparent machen:

- aktiver Scope
- genutzte Quellen
- Grenzen des Kontexts
- sensible Felder ausgeblendet

## 6.9 Typische Aktionen

- Modus wählen
- Deal oder Objekt als Kontext übergeben
- Follow-up-Frage stellen
- Ergebnis in Aufgabe umwandeln
- Zusammenfassung teilen
- Antwortentwurf erzeugen
- Freigabe oder Vertragsscreen öffnen

## 6.10 Besondere UX-Anforderung

Der AI Workspace darf sich weder wie ein generischer Chat noch wie ein technisches Kontrollpanel anfühlen. Er muss wie ein **fachlicher Denk- und Entscheidungsraum** wirken.

## 6.11 KPI- und Erfolgsbezug

Später könnten auch AI-Nutzungskennzahlen interessant sein, etwa:

- häufigste Modi
- durchschnittlich eingesparte Zeit pro Prozessschritt
- Anteil AI-unterstützter Freigaben
- Anteil AI-unterstützter Verhandlungszusammenfassungen
- Akzeptanzrate vorgeschlagener nächster Schritte

---

# 7. Platform Admin Console

## 7.1 Strategische Rolle des Screens

Die Platform Admin Console ist nicht für Mandantenkunden gedacht, sondern für den Betreiber von DealFlow One. Dieser Screen ist wichtig, damit die SaaS-Plattform insgesamt skalierbar, sicher, supportfähig und steuerbar bleibt.

Hier wird also nicht der kommerzielle Tagesprozess der Kunden gesteuert, sondern die **Betriebs-, Governance- und Plattformebene** des gesamten Produkts.

## 7.2 Hauptziele des Screens

Die Platform Admin Console soll ermöglichen:

- Mandantenüberblick
- Betriebs- und Sicherheitsstatus
- Feature-Rollouts
- Paket- und Modulsteuerung
- Support- und Auditunterstützung
- Beobachtung von Integrations- und Systemgesundheit

## 7.3 Primäre Nutzergruppen

- Plattformbetreiber
- interne Operations-Teams
- Support
- Security / Compliance
- Produktbetrieb
- ausgewählte Administratoren auf Betreiberseite

## 7.4 Grundlayout

### Bereich A: Tenant Overview

Übersicht aller Mandanten mit Informationen wie:

- Name
- Status
- Paket / Edition
- aktive Module
- Anzahl Nutzer
- Anzahl Firmen / Brands
- Integrationsstatus
- Health Score
- Auffälligkeiten

### Bereich B: Tenant Detail

Detailansicht eines Mandanten mit:

- gebuchte Funktionen
- genutzte Limits
- wichtige Konfigurationen
- Aktivitätsniveau
- Integrationsüberblick
- Sicherheitsereignisse
- Supporthistorie
- Release- und Feature-Status

### Bereich C: Plattform-Monitoring

- Systemgesundheit
- Eventvolumen
- API-Fehlerraten
- Webhook-Status
- Dokumenten- und Signaturdurchsatz
- AI-Nutzung auf aggregierter Ebene
- Speicher- und Verarbeitungsindikatoren

### Bereich D: Governance und Rollout

- globale Policies
- Feature Flags
- stufenweiser Rollout neuer Funktionen
- Beta- oder Early-Access-Freischaltungen
- systemweite Compliance-Hinweise

### Bereich E: Audit und Support Tools

- Audit Logs
- Konfigurationshistorie
- Supportzugriffe
- Tenant-Sichtprüfung unter strengen Regeln
- Incident-Analyse

## 7.5 Besondere Anforderungen

Die Platform Admin Console muss sehr streng von Tenant Admin Funktionen getrennt sein. Es darf keine Unklarheit darüber geben, welche Rechte der Betreiber hat und welche Datenzugriffe zulässig sind.

Gerade unter Datenschutz- und Sicherheitsgesichtspunkten braucht dieser Screen:

- klare Zugriffsbeschränkungen
- strenge Auditierung
- Transparenz über Supportzugriffe
- differenzierte Berechtigungen auf Betreiberseite

## 7.6 Typische Aktionen

- Mandantenstatus prüfen
- Feature für Tenant freischalten
- technische Konfiguration prüfen
- Webhook-Fehler analysieren
- Supportfall auf Tenant-Ebene nachvollziehen
- Audit oder Sicherheitsvorfall untersuchen

## 7.7 KPI-Sicht

Plattformweite KPIs könnten sein:

- aktive Mandanten
- aktive Nutzer
- API-Stabilität
- Dokumentenvolumen
- Signaturvolumen
- durchschnittliche Health Scores
- Fehlerraten in Integrationen
- Supportaufkommen nach Modul

## 7.8 UX-Prinzip

Die Platform Admin Console sollte klar nüchterner und betriebsnäher wirken als die Mandantenoberflächen. Hier geht es nicht um Abschlussführung, sondern um **SaaS-Kontrolle, Sicherheit und operativen Plattformbetrieb**.

---

# 8. Querschnittsprinzipien für alle restlichen Screens

## 8.1 Kontextklarheit auf jedem Screen

Auf jedem dieser Screens muss sichtbar bleiben:

- Mandant
- Firma
- Brand
- zugehöriger Deal oder Kunde, falls relevant
- maßgeblicher Dokumenten- oder Prozessstand

## 8.2 Rollen- und Scope-Konsistenz

Alle Screens müssen dieselben Sichtbarkeitsregeln anwenden. Ein Nutzer darf niemals in einem nachgelagerten Screen plötzlich Informationen sehen, die er im Deal Room oder Tenant Admin nicht sehen dürfte.

## 8.3 Versionierung als sichtbares Bedienprinzip

Wann immer ein Nutzer mit Angeboten, Verträgen, Preisänderungen oder Verhandlungen arbeitet, muss er erkennen können:

- auf welcher Version er arbeitet
- welche Version aktuell maßgeblich ist
- welche Version historisch ist
- ob eine Änderung Folgeversionen erzeugt

## 8.4 Audit und Nachvollziehbarkeit

Bei geschäftskritischen Aktionen sollte der Screen mindestens implizit nachvollziehbar machen, dass wichtige Schritte auditierbar sind, etwa bei:

- Freigaben
- Vertragsänderungen
- Signaturwechseln
- Preisänderungen
- Rechteänderungen
- API-bezogenen Konfigurationen

## 8.5 AI als Assistent, nicht als verdeckte Automatik

AI soll auf allen Screens helfen, aber nie unklar im Hintergrund entscheiden. Gute AI-Unterstützung in DealFlow One heißt:

- transparent
- kontextklar
- rollenbewusst
- nachvollziehbar
- kontrollierbar

---

# 9. End-to-End Flow über die restlichen Screens

## 9.1 Typischer New-Business-Abschlussflow

1. Deal Room zeigt reifen Deal
2. Quote Studio erstellt finale Angebotsversion
3. Contract Workspace erzeugt Vertragsversion
4. Kunde macht Gegenvorschlag
5. Negotiation Workspace strukturiert Änderungen
6. neue Freigaben laufen über Approval Hub
7. finaler Stand geht ins Signature Center
8. nach Vollsignatur übernimmt Order Confirmation & Handover Center
9. Reports & Performance Cockpit misst Zyklus und Erfolgskennzahlen
10. AI Copilot fasst Management- und Delivery-Sicht zusammen

## 9.2 Typischer Bestandskunden-Preisänderungsflow

1. Price Increase Center startet Preiserhöhungsfall
2. Vertragsbezug und Preislogik werden geprüft
3. Schreiben wird freigegeben und versendet
4. Kunde lehnt teilweise ab und macht Gegenvorschlag
5. Negotiation Workspace strukturiert die Rückmeldung
6. notwendige Freigaben oder Amendments werden ausgelöst
7. finale Einigung wird dokumentiert
8. ggf. Signatur oder Vertragsnachtrag läuft über Signature Center
9. Handover oder Systemübergabe erfolgt kontrolliert
10. Reporting misst Erfolgsquote und Umsatzwirkung

## 9.3 Typischer Management- und Steuerungsflow

1. Reports & Performance Cockpit zeigt Engpass im Vertragsreview
2. Manager öffnet betroffene Fälle im Deal Room oder Contract Workspace
3. AI Copilot erzeugt Zusammenfassung der Hauptursachen
4. Tenant Admin prüft, ob Rollen, Freigaberouten oder Vorlagen angepasst werden müssen
5. Platform Admin überwacht bei Bedarf tenantübergreifende Muster oder Systemauffälligkeiten

---

# 10. Fazit

Mit diesen restlichen Screens wird DealFlow One zu einer vollständigen kommerziellen Plattform und nicht nur zu einem CRM mit Dokumentenmodulen. Entscheidend ist, dass jeder Screen eine klar definierte Rolle im End-to-End-Commercial-Flow übernimmt:

- **Negotiation Workspace** macht Verhandlung strukturiert und steuerbar
- **Signature Center** macht Verbindlichkeit und Abschlussstatus transparent
- **Order Confirmation & Handover Center** macht den Übergang in die operative Welt sauber
- **Price Increase Center** professionalisiert Bestandskunden-Preislogik und Revenue Protection
- **Reports & Performance Cockpit** macht Leistung und Reibung messbar
- **AI Copilot Workspace** verbindet Themen intelligent und orchestriert Entscheidungen
- **Platform Admin Console** macht das Produkt als SaaS-Plattform kontrollierbar und skalierbar

In Kombination mit den zuvor beschriebenen Screens ergibt sich ein konsistentes Zielbild: **eine kommerzielle Multi-Tenant-Plattform mit einfacher Oberfläche, starker Governance, tiefer Prozesslogik und echter Steuerbarkeit vom Erstangebot bis zur operativen Übergabe und darüber hinaus**.

## Empfohlener nächster Schritt

Als nächstes wäre es fachlich sehr sinnvoll, auf Basis von Teil 1 und Teil 2 eines der folgenden Artefakte zu erzeugen:

1. **vollständige Screen-Spezifikation pro Screen mit konkreten UI-Komponenten**
2. **Navigations- und Informationsarchitektur der gesamten App**
3. **Wireframe-naher UX-Blueprint pro Kernscreen**
4. **Rollenmatrix je Screen und Aktion**
5. **MVP-Scope je Screen mit Phase 1, Phase 2 und Phase 3**

Dieses Dokument dient damit als belastbare Fortsetzung des Screen-by-Screen-Konzepts für die restlichen zentralen Produktbereiche von DealFlow One.
