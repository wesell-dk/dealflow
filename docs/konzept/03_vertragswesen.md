# DealFlow One – Best-in-Class Vertragswesen

Dieses Dokument ergänzt `00_gesamtkonzeption.md`, `01_datenmodell_rechte_api.md` und `02_screens_teil2.md` um eine vollständige, produktionsnahe Konzeption des Vertragswesens. Es ist als Blaupause für Produkt, UX, Architektur und Implementierung gedacht. Es baut auf den bereits existierenden Domänenobjekten auf (`contracts`, `clause_families`, `clause_variants`, `contract_clauses`, `contract_amendments`, `negotiations`, `customer_reactions`, `signature_packages`, `order_confirmations`, `price_increase_campaigns`) und beschreibt, wie diese zu einem echten Contract-Lifecycle-Management ausgebaut werden.

---

## 1. Executive Summary

Das Vertragswesen von DealFlow One soll best in class werden. „Best in class" bedeutet im Kontext einer sales-first Commercial-Execution-Plattform nicht „besseres DMS" und nicht „besserer Word-Generator", sondern: der Vertrag ist ein strukturiertes Geschäftsobjekt, das jederzeit Auskunft darüber gibt, was kommerziell, rechtlich und operativ zwischen DealFlow One und einem Kundenkonto vereinbart wurde – und was sich daraus an aktiven Pflichten, Risiken, Fristen, Renewals und Preisänderungen ableitet.

Anders als klassische CLM-Systeme, die Verträge primär als Dateien mit Metadaten verwalten, modelliert DealFlow One Verträge als versionierte Bündel aus Klauseln, Konditionen, Pflichten und kommerziellen Eckwerten. Diese Bündel sind direkt mit Deal, Quote, Pricing, Approvals, Verhandlungen, Signatur und Auftragsbestätigung verknüpft. Der Vertrag ist damit nicht das letzte Glied einer Kette, sondern der zentrale kommerzielle Wahrheitsträger – vor, während und nach der Signatur.

Anders als klassische CRM-Systeme, in denen Verträge eher ein angeflanschter Anhang am Deal sind, behandelt DealFlow One die Vertragsphase als gleichberechtigten ersten Bürger der Plattform: mit eigenem Workspace, eigener Verhandlungsoberfläche, eigener Approval- und Signaturlogik, eigener Post-Signature-Steuerung und eigener KI-Schicht.

Anders als reine eSign-Tools deckt DealFlow One den gesamten Lebenszyklus ab: vom regelbasierten Erzeugen aus Bausteinen über mehrrundige Verhandlungen mit Gegenpapieranalyse, Risk-Scoring und Approvals bis zu Post-Signature-Steuerung mit Obligations, Renewal-Risiken, Amendments und Preisänderungsschreiben.

Multi-Tenancy, Multi-Company und Multi-Brand sind nicht aufgesetzt, sondern in jedem Vertragsobjekt, jeder Klausel, jeder Policy und jeder API-Antwort nativ verankert. Eine Marke darf nur das sehen, womit sie laut Scope vertraglich umgehen darf. Ein Tenant Admin steuert granular, wer welchen Vertragstyp lesen, vorschlagen, verhandeln, freigeben oder signieren darf.

Die KI ist tief in jede Phase eingebettet, nicht als Chat-Add-on, sondern als kontextualisierte Entscheidungs- und Orchestrierungsschicht: sie erklärt Risiken klauselscharf, schlägt zulässige Varianten vor, vergleicht Gegenpapiere mit dem internen Standard, fasst Verhandlungshistorien für Manager zusammen und bereitet Preiserhöhungsschreiben vor – immer scope-sensitiv, immer rechte-aware, immer auditierbar.

---

## 2. Best-in-Class-Prinzipien

Die folgenden Leitprinzipien sind verbindlich. Jede Designentscheidung im Vertragswesen muss sich an ihnen messen lassen.

**Deal-native.** Ein Vertrag entsteht nicht im luftleeren Raum, sondern aus einem Deal mit Pipeline-Stand, Wert, Marke, Company und Verantwortlichkeit. Vertragsobjekt und Deal sind referenziell und semantisch verbunden. Änderungen am Deal (Wert, Brand, Phase) propagieren erkennbar in den Vertrag, ohne ihn unbemerkt zu überschreiben.

**Quote-native.** Jeder Vertrag wird gegen genau eine akzeptierte Quote-Version gebunden. Preispositionen, Discounts, Bundles und Geltungsdauern aus dieser Quote-Version sind die kommerzielle Grundlage des Vertrags und werden bei Drift sofort als Inkonsistenz markiert.

**Pricing-native.** Preisinformationen leben nicht als kopierter Text im Vertrag, sondern als strukturierte Referenz auf Preispositionen und Preisbücher. Eine Preisänderung im Vertragskontext geschieht über einen sauberen Preisänderungsprozess, nicht über Textbearbeitung.

**Approval-native.** Jede Abweichung vom Standard wird automatisch klassifiziert (gering, mittel, hoch, kritisch) und löst regelgesteuert die richtigen Approvals in der richtigen Reihenfolge aus. Approver sehen nicht nur „eine Abweichung", sondern eine vollständige Begründung, einen finanziellen und rechtlichen Impact und KI-Empfehlung.

**Negotiation-native.** Verhandlungen sind ein eigener strukturierter Arbeitsbereich, kein Email-Anhang-Pingpong. Customer Reactions, Counterproposals, offene Punkte und Deadlines sind erstklassige Objekte mit Verantwortlichkeit, Risk-Score und Auflösungsstatus.

**AI-native.** KI wird nicht „dazugebaut", sondern in die Objektmodelle integriert. Empfehlungen, Erklärungen, Risiko-Scores und Confidence-Werte sind referenzierbare Entitäten (`ai_recommendations`, `ai_explanations`) mit Auditspur und Rechteprüfung im Kontextaufbau.

**Lifecycle-native.** Der Vertrag stirbt nicht mit der Signatur. Obligations, Fristen, Renewal-Fenster, Kündigungsfenster, Auto-Renewal-Klauseln und Amendments laufen aktiv weiter und steuern Erinnerungen, Aufgaben und Eskalationen.

**Governance-native.** Policies sind kein Feature, sondern eine Schicht. Eine Tenant-Policy entscheidet beispielsweise: "Haftung > 1 Mio. € benötigt zwingend Legal-Approval und ist für Marke 'Helix Industrial' überhaupt nicht zulässig." Diese Policies sind versioniert und nachvollziehbar.

**Multi-entity-native.** Tenant, Company und Brand sind feste Bestandteile jedes Vertrags. Jede Sicht, jede Suche, jede KI-Anfrage, jede API-Antwort respektiert diese Hierarchie ohne Ausnahmen.

**Audit-native.** Jede Statusänderung, jede Klauselveränderung, jede Approval-Entscheidung, jede KI-Empfehlung und jede manuelle Übersteuerung wird mit Zeitstempel, Akteur, Begründung und Vorher-/Nachher-Snapshot persistiert.

**User-friendly by default.** Die Standardbedienung muss in 90 % der Fälle ohne Klick auf "Erweitert" auskommen. Komplexität ist da, aber sie wird progressiv offenbart.

**Automation first, but controllable.** Der Standardpfad ist automatisiert (Vertrag aus Quote bauen, Standardklauseln einsetzen, Standardapprover routen, Signaturpaket vorbereiten). Erfahrene Nutzer können jederzeit eingreifen, jede Automatisierung ist transparent und reversibel.

**Simple in operation, powerful in depth.** Die Oberfläche ist klar (drei Hauptbereiche pro Screen). Unter der Oberfläche stehen Versionierung, Diff-Engine, Policy-Engine, Risiko-Engine, KI-Schicht, Obligations-Engine, API-Versionierung und Audit-Trail bereit.

---

## 3. Fachliches Zielbild

Das Vertragswesen ist eine eigenständige, vollständige Domäne mit folgendem End-to-End-Umfang.

**Vertragserstellung.** Aus einem Deal heraus wird ein Vertragsentwurf erzeugt. Grundlage sind Vertragstyp, Playbook, Brand-/Company-Kontext, Region/Sprache, Kundenattribute und die akzeptierte Quote-Version. Jede Klausel wird aus einer `clause_family` mit der für diesen Kontext zulässigen `clause_variant` (soft/standard/hard) befüllt. Pflichtklauseln werden gesetzt, optionale angeboten, gesperrte ausgeschlossen.

**Vertragsprüfung.** Eine Deviation- und Policy-Engine prüft jeden Entwurf gegen die Tenant-, Company- und Brand-Policies. Abweichungen werden klassifiziert, mit finanziellem/rechtlichem/operativem/datenschutzrelevantem Impact angereichert und in eine Abweichungsliste überführt.

**Verhandlung.** Verhandlungen sind mehrrundig. Pro Runde gibt es Customer Reactions (Zustimmung, Ablehnung, Counterproposal, Frage). Eine Reaktion erzeugt offene Punkte mit Verantwortlichem (Sales/Legal/Finance), Deadline und Auflösungspfad. Das System unterscheidet Dokumentversionen und Geschäftsversionen: zwei Klauseländerungen ohne kommerziellen Effekt ergeben keine neue Geschäftsversion.

**Gegenpapieranalyse.** Lädt der Kunde ein eigenes Vertragspapier hoch, wird es geparst, Klauseln werden auf die interne Library gemappt, Abweichungen werden erkannt und mit Risk-Score versehen. Die KI schlägt pro Klausel Annahme, Ablehnung, alternative Formulierung oder Eskalation vor.

**Freigaben.** Vor Signatur werden alle Abweichungen abgearbeitet. Approvals laufen rollenbasiert (Sales Manager, Finance, Legal, Executive) und policy-basiert (z. B. Haftungsobergrenze).

**Signatur.** Ein `signature_package` bündelt alle Dokumente, Signer, Reihenfolge (sequenziell/parallel), Deadline, interne und externe Unterzeichner. Status, Mahnungen, Rückläufer und Ablehnungen werden lückenlos getrackt.

**Ablage.** Der signierte Vertrag bleibt strukturiertes Geschäftsobjekt, nicht „nur PDF". Das PDF ist eine Manifestation, die Wahrheit lebt in den strukturierten Klauseln, Pflichten und Konditionen.

**Pflichtenmanagement.** Aus jeder Klausel mit zeitlicher oder operativer Pflicht (Lieferung bis X, Reporting alle Y, SLA Z) entsteht eine `obligation` mit Verantwortlichem, Fälligkeit, Status und Erinnerungslogik.

**Amendments.** Änderungen nach Signatur sind keine neuen Verträge, sondern strukturierte Nachträge. Jeder Nachtrag besteht aus add-/replace-/remove-Operationen auf Klauseln und braucht eigenen Approval-Pfad und eigene Signatur.

**Renewals.** Renewal-Fenster werden aus Vertragsdaten abgeleitet. Eine `renewal_opportunity` ist ein eigenes Geschäftsobjekt, das in der Pipeline auftaucht und die KI nutzt, um Renewal-Risiken vorherzusagen.

**Preisänderungen.** Preisänderungsschreiben (Price Increase Cases) sind ein eigenständiger Workflow mit Begründung, Berechnung, Versand, Tracking der Kundenreaktion und Folgen für Vertrag und Forecast.

**Kündigungsfenster.** Kündigungsfristen werden aktiv überwacht. Vor Eintritt eines Kündigungsfensters wird der zuständige Account-Owner oder Customer Success informiert.

**Reporting & Performance.** Vertragsdaten füttern die Performance-Layer: Time-to-Signature, Verhandlungsdauer, häufigste Abweichungen, Risikoverteilung nach Brand/Company/Region, Renewal-Risiken, Annahmequote von Preisänderungen.

**API-Zugriff.** Über Tenant-skopierte APIs können Drittsysteme den Vertragsstatus, Pflichten, Versionen und gültige Preispositionen abrufen. Jede API-Antwort respektiert das Sichtbarkeitsmodell.

**Tenantweite Governance.** Tenant Admins steuern, welche Vertragstypen, Playbooks und Klauselvarianten für welche Companies und Brands aktiv sind, welche Approvals greifen und welche Sichtbarkeitsregeln gelten.

---

## 4. Detailliertes Domain Model

Das Modell ist als Erweiterung des bestehenden Drizzle-Schemas zu lesen. Vorhandene Tabellen werden genutzt und gezielt ergänzt.

### 4.1 Organisations- und Identitätsobjekte

**Tenant.** Bestehender erster Bürger. Jeder Vertrag, jede Klauselbibliothek, jede Policy ist tenant-scoped. Felder: `id`, `name`, `plan`, `region` (Datenresidenz), `defaultLocale`.

**Company.** Rechtliche Einheit innerhalb des Tenants. Verträge werden für Customer Accounts geschlossen, aber im Namen einer Company unterzeichnet. Felder: `id`, `tenantId`, `legalName`, `vatId`, `defaultBrandId`.

**Brand.** Markenauftritt innerhalb einer Company. Bestimmt Logo, Farben, Sprache und mögliche Vertragstypen. Felder: `id`, `companyId`, `name`, `theme`, `legalSuffix`.

**User.** Person mit Login. Felder: `id`, `tenantId`, `email`, `name`, `status`. Sichtbarkeit über `user_scopes`.

**Role.** Rollendefinition (Tenant Admin, Company Admin, Brand Admin, Sales Rep, Sales Manager, Legal, Finance, Approver, Executive, Customer Success, Auditor, DPO).

**Permission.** Atomare Berechtigung. Beispiele: `contract.read`, `contract.draft`, `contract.negotiate`, `contract.approve`, `contract.sign`, `contract.export`, `contract.api.read`, `clause.edit.hard`. Permissions werden zu Rollen gebündelt.

**user_scope.** Tabelle, die einem User pro Tenant einen Sichtbarkeitsscope gibt: `tenantId`, alle/ausgewählte Companies, alle/ausgewählte Brands. Jeder Vertragslesezugriff wird durch ein Scope-Filter passieren.

### 4.2 Kunden- und Deal-Kontext

**Customer Account.** Der Vertragspartner. Felder: `id`, `tenantId`, `legalName`, `country`, `industry`, `riskClass`, `dpoContact`.

**Contact.** Person beim Kunden. Felder: `id`, `accountId`, `name`, `role`, `email`, `signingAuthority` (boolean + Schwelle).

**Deal.** Bereits vorhanden. Vertrag wird über `dealId` referenziert. Ein Deal kann genau einen aktiven Vertrag haben, aber mehrere historische Verträge (Renewals, Replacements).

**Deal Stage.** Bereits vorhanden. Phasenwechsel können Vertragsaktionen triggern (z. B. „Verhandlung" → Vertragsentwurf vorbereiten).

### 4.3 Kommerzielle Grundlage

**Quote.** Bereits vorhanden. Wird via `dealId` und `quoteId` mit Vertrag verknüpft.

**Quote Version.** Ein Vertrag bindet sich an genau eine Quote-Version (`acceptedQuoteVersionId`). Spätere Änderungen am Quote führen entweder zu einer Vertrags-Drift-Warnung oder zu einem Amendment.

**Price Position.** Strukturierte Preisposition aus dem Pricing-Modul. Vertrag referenziert sie statt Texte zu kopieren.

**Price Book / Price List.** Tenant-/Brand-spezifische Preislisten als Quelle.

**Discount Rule.** Regel, ab welcher Discount-Schwelle Approvals nötig werden. Wird sowohl auf Quote- als auch auf Vertragsebene wirksam.

### 4.4 Approval-Domäne

**Approval Case.** Bereits vorhanden (`approvals`). Erweiterung: `category` (financial/legal/operational/privacy), `policyId` (welche Policy hat ihn ausgelöst), `evidence` (Snapshot der Werte, die zur Auslösung führten).

**Approval Decision.** Pro Approval Case mehrere Decisions möglich (mehrstufige Approvals): `approverId`, `decision` (approved/rejected/delegated), `comment`, `decidedAt`, `delegateId`.

### 4.5 Vertragsobjekte (Kern)

**Contract.** Bereits vorhanden. Erweiterungen: `tenantId`, `companyId`, `brandId`, `accountId`, `dealId`, `acceptedQuoteVersionId`, `contractTypeId`, `playbookId`, `language`, `currency`, `effectiveFrom`, `effectiveTo`, `autoRenewal`, `renewalNoticeDays`, `terminationNoticeDays`, `governingLaw`, `jurisdiction`, `riskLevel`, `riskScore` (numerisch), `status` (draft/in_review/in_negotiation/approved/sent_for_signature/signed/active/amended/renewed/terminated/expired/lost), `currentVersion`, `valueCurrency`, `valueAmount`, `obligationsCount`, `openDeviationsCount`.

**Contract Version.** Versionierte Manifestation des Vertragsinhalts. Felder: `id`, `contractId`, `versionNumber`, `versionType` (document/business), `createdBy`, `createdAt`, `summary`, `parentVersionId`, `redlineFromVersionId`, `pdfRenditionId`, `state`. Klauselzustände leben in `contract_clauses` mit `versionId`.

**Contract Type.** Stammdaten: NDA, MSA, SOW, DPA, Subscription, Service Agreement, Reseller Agreement, Order Form, Amendment Template. Pro Type: Pflichtfelder, Pflichtklauseln, erlaubte Brand-/Company-Kombinationen, Default-Approval-Regeln.

**Contract Playbook.** Konfiguriertes Bündel aus Vertragstyp + erlaubten Klauselvarianten + Defaultwerten + Approval-Regeln. Pro Brand mehrere Playbooks möglich (z. B. „Standard Subscription DACH", „Strategic Subscription Enterprise").

**Clause.** Bereits vorhanden (`contract_clauses`). Konkrete Instanz einer Klausel in einem Vertrag. Felder: `contractId`, `versionId`, `familyId`, `activeVariantId`, `severity`, `summary`, `editedBody`, `editedReason`, `lockedReason`.

**Clause Variant.** Bereits vorhanden. Vorgeschlagene Formulierung. Felder: `familyId`, `severity` (soft/standard/hard), `severityScore`, `summary`, `body`, `riskNotes`, `requiredApprovals`, `compatibleVariantIds`, `incompatibleVariantIds`.

**Clause Family.** Bereits vorhanden. Logische Gruppe (z. B. Haftung, DPA, Auto-Renewal, Kündigung, Preisänderung, Geheimhaltung).

**Clause Deviation.** Konkretisiert eine Abweichung in einem Vertrag. Felder: `contractId`, `versionId`, `clauseId`, `deviationType` (variant_change/text_edit/missing_required/forbidden_used), `severity`, `policyId`, `requiresApproval`, `approvalCaseId`, `aiExplanationId`, `resolvedAt`, `resolvedBy`.

### 4.6 Verhandlungsobjekte

**Negotiation Case.** Bereits vorhanden (`negotiations`). Klammer um eine Verhandlungsphase eines Deals/Vertrags. Felder: `dealId`, `contractId`, `status` (open/in_review/waiting_customer/escalated/concluded), `round`, `lastReactionType`, `riskLevel`, `nextActionDueAt`, `assignedTeam`.

**Counterproposal.** Vorschlag (intern oder extern) für eine alternative Klauselvariante oder einen alternativen Wert. Felder: `negotiationId`, `clauseId`, `proposedVariantId`, `proposedText`, `direction` (we_propose/customer_proposes), `rationale`, `riskScore`, `aiRecommendationId`, `status` (open/accepted/rejected/superseded).

**Customer Reaction.** Bereits vorhanden. Felder: `negotiationId`, `type` (accept/reject/counterproposal/question), `topic`, `priority`, `impactPct`, `requestedClauseVariantId`, `sourceChannel` (email/call/portal/upload), `attachmentId`.

**External Paper.** Vom Kunden gelieferte Vertragsdatei. Felder: `id`, `contractId`, `negotiationId`, `originalFilename`, `objectPath`, `parsingStatus`, `mappedClauses` (n:n auf clause_families mit Confidence), `riskFindings`.

**Risk Finding.** Strukturiertes KI-Ergebnis aus Gegenpapieranalyse. Felder: `externalPaperId`, `clauseFamilyId`, `severity`, `riskCategory` (financial/legal/operational/privacy), `extractedText`, `aiExplanationId`, `recommendedAction`, `humanDecision`.

### 4.7 Signatur und Abschluss

**Signature Package.** Bereits vorhanden. Felder: `dealId`, `contractId`, `amendmentId`, `mode` (sequential/parallel), `deadline`, `status`, `provider` (z. B. DocuSign, Adobe Sign, internal), `auditTrailRef`.

**Signer.** Bereits vorhanden. Felder: `packageId`, `name`, `email`, `role` (customer/internal_legal/internal_finance/internal_executive), `order`, `status` (pending/sent/viewed/signed/declined/bounced), `signedAt`, `declineReason`, `signingAuthorityVerified`.

**Order Confirmation.** Bereits vorhanden (`order_confirmations`). Bindeglied zwischen signiertem Vertrag und nachgelagerter operativer Umsetzung.

### 4.8 Post-Signature

**Amendment.** Bereits vorhanden (`contract_amendments`). Strukturierte Vertragsänderung nach Signatur. Felder: `originalContractId`, `number`, `type` (commercial/legal/scope/renewal/correction), `status` (draft/in_review/in_negotiation/signed/active/rejected), `effectiveFrom`, `triggeringEvent`, `signaturePackageId`.

**Amendment Clause.** Bereits vorhanden. Operationen auf Klauseln: `add`/`replace`/`remove`.

**Renewal Opportunity.** Eigenständiges Pipelineobjekt. Felder: `originalContractId`, `dealId` (neu erzeugt), `expectedRenewalDate`, `noticeWindowStart`, `noticeWindowEnd`, `riskScore`, `aiRecommendation`, `status` (planned/active/won/lost/auto_renewed).

**Price Increase Case.** Bereits vorhanden (`price_increase_campaigns`) auf Kampagnenebene. Pro Vertrag entsteht ein einzelner Case mit: `campaignId`, `contractId`, `baselinePricePositions`, `proposedUpliftPct`, `effectiveDate`, `clauseBasisId` (welche Klausel erlaubt die Anpassung), `letterDocumentId`, `customerReactionType`, `acceptedAt`, `escalatedAt`.

**Obligation.** Aus Klauseln abgeleitete Pflicht. Felder: `contractId`, `clauseId`, `type` (delivery/reporting/sla/payment/notice/audit), `description`, `dueAt`, `recurrence` (none/monthly/quarterly/annual), `ownerId`, `escalationRule`, `status` (pending/in_progress/done/missed/waived).

**Milestone.** Geschäftlich relevante Vertragsmarke (Go-Live, Reportingdatum, Rampe). Felder: `contractId`, `name`, `dueAt`, `status`.

### 4.9 KI- und Auditobjekte

**AI Recommendation.** Strukturierte Empfehlung. Felder: `id`, `entityType`, `entityId`, `recommendationType` (variant_choice/approval_path/counterproposal_text/price_uplift/escalation), `payload` (JSON), `confidence`, `rationale`, `evidence` (Quellen-IDs), `createdAt`, `humanDecision`.

**AI Explanation.** Erklärung in Geschäftssprache zu einer Empfehlung oder einem Risiko. Felder: `id`, `recommendationId`, `entityType`, `entityId`, `text`, `audience` (sales/legal/finance/exec), `createdAt`.

**Audit Event.** Universeller Audit Trail. Felder: `id`, `tenantId`, `entityType`, `entityId`, `actorId`, `actorRole`, `action`, `payloadBefore`, `payloadAfter`, `policyId`, `aiInvolved` (boolean), `createdAt`.

**API Access Scope.** Pro API-Token: erlaubte Tenant/Companies/Brands, erlaubte Endpunkte, Read/Write, Rate Limit, Ablauf, IP-Restriktionen.

**Data Retention Rule.** Pro Vertragstyp/Brand/Region: wie lange Verträge, Anhänge, Verhandlungshistorien, Audit-Events aufbewahrt werden, wann sie pseudonymisiert oder gelöscht werden.

**Privacy Event.** DSGVO-relevanter Vorgang (Auskunft, Löschung, Pseudonymisierung) mit Bezug zum Vertrag oder zu personenbezogenen Daten in Klauseln.

### 4.10 Beziehungen

Schematisch:

```
Tenant ─< Company ─< Brand
          │
          └─< Customer Account ─< Contact
                   │
                   └─< Deal ─< Quote ─< Quote Version ─< Price Position
                          │
                          └─< Contract ─< Contract Version ─< Contract Clause ─> Clause Variant ─> Clause Family
                                  │            │
                                  │            └─< Clause Deviation ─> Approval Case ─< Approval Decision
                                  │
                                  ├─< Negotiation ─< Customer Reaction
                                  │             ─< Counterproposal
                                  │             ─< External Paper ─< Risk Finding
                                  │
                                  ├─< Signature Package ─< Signer
                                  │
                                  ├─< Amendment ─< Amendment Clause
                                  │
                                  ├─< Renewal Opportunity
                                  ├─< Price Increase Case
                                  ├─< Obligation
                                  └─< Milestone

AI Recommendation, AI Explanation, Audit Event, Privacy Event hängen polymorph an entityType/entityId.
```

### 4.11 Lebenszyklen (Statuszustände)

**Contract Status:** `draft` → `in_review` → `in_negotiation` ↔ `pending_approval` → `approved` → `sent_for_signature` → `signed` → `active` → (`amended` | `renewed` | `terminated` | `expired` | `lost`).

**Amendment Status:** `draft` → `in_review` → `in_negotiation` ↔ `pending_approval` → `approved` → `sent_for_signature` → `signed` → `active` (oder `rejected`).

**Negotiation Status:** `open` → `in_review` ↔ `waiting_customer` ↔ `escalated` → `concluded`.

**Approval Case Status:** `pending` → `approved` | `rejected` | `delegated` | `withdrawn`.

**Signature Package Status:** `draft` → `sent` → `partially_signed` → `signed` | `declined` | `expired`.

**Obligation Status:** `pending` → `in_progress` → `done` | `missed` | `waived`.

**Renewal Opportunity Status:** `planned` → `active` → `won` | `lost` | `auto_renewed`.

**Price Increase Case Status:** `proposed` → `letter_drafted` → `letter_sent` → `accepted` | `rejected` | `countered` | `escalated`.

---

## 5. Rollen- und Rechtemodell

Das Rechtemodell hat drei orthogonale Achsen: **Sichtbarkeit** (welche Tenants/Companies/Brands?), **Objekt-/Aktionsrechte** (welche Aktionen auf welchen Objekttypen?), **Daten-/Klauselrechte** (welche Felder/Klauseln innerhalb eines Objekts?).

### 5.1 Standardrollen

**Tenant Admin.** Vollzugriff im Tenant. Verwaltet Companies, Brands, Rollen, Policies, Vertragstypen, Playbooks, API-Tokens. Sieht alles, kann alles delegieren.

**Company Admin.** Verwaltet eine oder mehrere Companies inkl. ihrer Brands, Playbooks und User-Scopes. Kann company-spezifische Policies feinjustieren, sofern der Tenant Admin es erlaubt.

**Brand Admin.** Verwaltet eine Marke (Logo, Farben, Default-Sprache, brandspezifische Klauselvarianten innerhalb erlaubter Grenzen).

**Sales Rep.** Erstellt Deals und Quotes, baut Vertragsentwürfe aus Standard-Playbooks, verhandelt im Rahmen erlaubter Varianten, fordert Approvals an. Kann nur Brands/Companies sehen, die in seinem Scope liegen.

**Sales Manager.** Wie Sales Rep, plus Approval-Berechtigung für definierte Schwellen, plus Sicht auf Team-Pipeline.

**Legal.** Volle Sicht auf Klauseln und Verhandlungen, Berechtigung zum Bearbeiten von `hard`-Klauseln, Approval für legal-relevante Abweichungen, alleinige Berechtigung zum Editieren bestimmter Pflichtklauseln (DPA, Haftung, Geheimhaltung).

**Finance.** Sicht auf kommerzielle Konditionen und Risiken, Approval für finanzielle Abweichungen (Discount-Schwellen, Zahlungsziele, Pönalen).

**Approver.** Generische Approval-Rolle, die per Policy auf bestimmte Approval-Typen geroutet wird.

**Executive.** Lesezugriff auf Management-Dashboards, Approval für Sonderfreigaben (sehr hohe Werte, strategisch sensible Verträge).

**Customer Success.** Liest Verträge und Pflichten der von ihm betreuten Accounts, sieht Renewal-Risiken und Obligation-Status, kann Amendments anstoßen.

**Auditor / Compliance / DPO.** Read-only über alles im Tenant, inklusive Audit Trail, KI-Logs, Privacy Events. Keine Bearbeitungs-, Approval- oder Signaturrechte.

**Externe Mitwirkende (optional).** Externer Anwalt oder Berater. Read-only oder Kommentar-only auf einen einzelnen Vertrag. Zeitlich begrenzter Magic-Link-Zugang.

### 5.2 Sichtbarkeit auf Tenant-, Company- und Brand-Ebene

Jeder User hat im `user_scope` eine Liste von Companies und Brands, auf die er zugreifen darf. Wenn die Brand-Liste leer ist, gilt die volle Brand-Liste der erlaubten Companies. Jede Vertragsabfrage legt die folgenden Filter automatisch an:

```
WHERE tenantId = :userTenant
  AND companyId IN (:userCompanies)
  AND brandId   IN (:userBrands)
```

Listenansichten, Suche, Reports, KI-Kontextaufbau und API-Antworten unterliegen demselben Filter ohne Ausnahme. Ein Sales Rep, der nur Brand „Helix Industrial" darf, sieht im Verhandlungs-Workspace, im Approval Hub, im Reporting und in der API ausschließlich Verträge mit `brandId = helix-industrial`.

### 5.3 Aktionsrechte (Beispielmatrix)

| Aktion                                   | Sales Rep | Sales Mgr | Legal | Finance | Tenant Admin |
|------------------------------------------|-----------|-----------|-------|---------|--------------|
| `contract.read`                          | scope     | scope     | all   | all     | all          |
| `contract.draft.create`                  | ja        | ja        | ja    | nein    | ja           |
| `contract.clause.edit.soft`              | ja        | ja        | ja    | nein    | ja           |
| `contract.clause.edit.standard`          | nein      | ja        | ja    | nein    | ja           |
| `contract.clause.edit.hard`              | nein      | nein      | ja    | nein    | ja           |
| `contract.deviation.request`             | ja        | ja        | ja    | nein    | ja           |
| `approval.decide.financial`              | nein      | bis X €   | nein  | ja      | ja           |
| `approval.decide.legal`                  | nein      | nein      | ja    | nein    | ja           |
| `approval.decide.executive`              | nein      | nein      | nein  | nein    | ja           |
| `signature.send`                         | ja        | ja        | ja    | nein    | ja           |
| `signature.assign_signer.internal`       | ja        | ja        | ja    | ja      | ja           |
| `signature.sign.internal`                | nein      | nach Voll­macht | ja | ja  | ja          |
| `contract.export.pdf`                    | scope     | scope     | scope | scope   | all          |
| `contract.api.read`                      | über Token | über Token | über Token | über Token | über Token |
| `clause.privacy.read`                    | maskiert  | maskiert  | ja    | maskiert | ja          |

`scope` bedeutet: nur innerhalb des `user_scope`.
`maskiert` bedeutet: sensible Felder (z. B. Subprozessoren-Liste, personenbezogene Datenkategorien) werden ausgeblendet oder zusammengefasst dargestellt.

### 5.4 Sonderrechte

**Klauselbearbeitung.** Jede `clause_family` definiert, welche Rolle welche Severity-Stufe bearbeiten darf. Eine `hard`-Klausel kann standardmäßig nur Legal ändern, eine `soft`-Klausel jeder Sales Rep mit `contract.draft.create`.

**Verhandlungsrechte.** Wer eine Verhandlung führt, ist der `assignee`. Erst nach Zuweisung kann diese Person Reactions verarbeiten und Counterproposals machen. Sales Manager und Legal können eingreifen, wenn die Policy es erlaubt.

**Freigaberechte.** Approvals werden per Policy auf Rollen geroutet (z. B. „Discount > 15 % → Sales Manager + Finance"). Alternative Approver können delegiert werden, ein Approval kann nicht durch den auslösenden User selbst entschieden werden (Segregation of Duties).

**Signaturfreigaben.** Vor dem Versand an externe Signer braucht es ein internes „Release for Signature" durch eine berechtigte Rolle. Dies ist eine eigene Approval-Stufe, die nicht mit den fachlichen Approvals vermischt wird.

**Export- und API-Nutzung.** Export per PDF, CSV oder API ist eigenständig berechtigt und wird audit-pflichtig protokolliert. Pro Token gibt es einen API Access Scope (Tenant/Companies/Brands/Endpoints).

**Sensible Inhalte / DSGVO.** Klauselfamilien mit personenbezogenen Daten (Auftragsverarbeitung, Subprozessoren) sind mit `privacy = true` markiert. Wer diese sehen darf, wird über `clause.privacy.read` gesteuert. Die KI-Kontextbildung respektiert dasselbe Flag und filtert solche Inhalte aus dem Prompt-Kontext, wenn der Anfragende sie nicht sehen darf.

**Delegation und Stellvertretung.** Approver können eine zeitlich begrenzte Stellvertretung definieren (Urlaub, Abwesenheit). Stellvertretungen werden im Audit Trail explizit ausgewiesen.

**Eskalationsrechte.** Eine Eskalation (z. B. „Verhandlung steht 5 Tage still") wird automatisch ausgelöst und an die nächsthöhere Ebene gemäß Policy weitergeleitet. Eskalationen sind zeitsensitiv und sichtbar in Manager-Dashboards.

### 5.5 Governance-Regeln (abgeleitet)

- Kein User darf seine eigenen Approvals entscheiden.
- Kein User darf einen Vertrag exportieren, der nicht in seinem Scope liegt.
- Kein API-Token darf Daten außerhalb seines API Access Scope ausliefern.
- Jede Klauselbearbeitung außerhalb des Standardplaybooks erzeugt eine `clause_deviation`.
- Jede manuelle Übersteuerung einer KI-Empfehlung wird auditiert und zählt in die Performance-Statistik des Users.
- Jede Sichtbarkeitsänderung an `user_scope` benötigt Tenant-Admin- oder delegierte Company-Admin-Rechte und ist auditiert.

---

## 6. End-to-End Prozesse

Die folgenden Prozesse sind die operativen Hauptflüsse. Sie verbinden Domänenobjekte, Rollen, Approvals und KI.

### 6.1 Vertragserstellung aus Deal und Quote

1. Sales Rep arbeitet im Deal Room mit einer akzeptierten Quote-Version.
2. Klick „Vertrag vorbereiten" öffnet einen Dialog: Vertragstyp (vorbelegt aus Brand-Default), Playbook, Sprache, Region, optional Customer-Side-Counterparty.
3. System lädt Playbook, ermittelt Pflicht- und Defaultklauseln, befüllt Variablen aus Deal/Quote/Account/Brand (Vertragsparteien, Konditionen, Geltungsdauer, Preispositionen via Referenz).
4. KI prüft Konsistenz (Quote ↔ Vertrag), schlägt für Ermessensklauseln (z. B. Zahlungsziel) Werte vor, weist auf fehlende Daten hin.
5. Vertragsentwurf wird in Status `draft` geschrieben, `currentVersion = 1` (`document` und `business`).
6. Deviation-Engine läuft: jede Klausel wird gegen Standard und Policies geprüft, Abweichungen werden materialisiert.
7. Sales Rep sieht im Contract Workspace eine geordnete Aufgabenliste: „Diese Klauseln brauchen deine Aufmerksamkeit", „Diese Approvals werden bei Verhandlungsstart fällig", „Diese Felder sind unvollständig".

### 6.2 Verhandlung und Gegenpapier

1. Verhandlung startet (Status `in_negotiation`, neue Negotiation-Round).
2. Eingehende Reaktion: per Email-Inbox-Anbindung, manuell erfasst oder als Upload eines externen Vertragspapiers.
3. Bei Gegenpapier: Parsing → Klausel-Mapping → Risk-Findings → Diff zu interner Vorlage.
4. KI generiert pro Risk-Finding eine Empfehlung (akzeptieren/ablehnen/alternative Variante/eskalieren) inkl. Confidence und Begründung.
5. Sales bzw. Legal entscheidet pro Finding. Akzeptierte Findings werden als Counterproposal in den Vertrag übernommen, was die `business`-Version bei kommerziellem Effekt erhöht.
6. Offene Punkte wandern in eine Tasklist mit Verantwortlichkeit, Deadline, Eskalationsregel.
7. Bei jeder Vertragsänderung wird die Deviation-Engine erneut gefeuert, Approvals werden automatisch geroutet oder zurückgenommen.
8. Der Verhandlungs-Workspace zeigt jederzeit: aktuelle Geschäftsversion, offene Punkte, Risk-Score, KI-Empfehlung „nächste Schritte".

### 6.3 Approval-Flow

1. Eine `clause_deviation` mit `requiresApproval=true` erzeugt einen `approval_case`.
2. Policy-Engine ermittelt Approver-Sequenz (z. B. Sales Manager → Finance → Legal).
3. Approver erhält Inbox-Eintrag mit Snapshot der Abweichung, Impact, KI-Erklärung, Verlauf.
4. Approver entscheidet (`approved`/`rejected`/`delegated`). Bei Ablehnung kehrt der Vertrag in `in_negotiation` zurück mit klarer Begründung.
5. Wenn alle Approval Cases `approved` sind und keine offenen Verhandlungspunkte mehr existieren, wechselt der Vertrag in `approved`.

### 6.4 Signatur

1. Berechtigter User stellt das Signature Package zusammen: Dokumente (Vertrag + Anlagen), Reihenfolge, Signer (intern + extern), Deadline, Erinnerungen.
2. Internes „Release for Signature" durch berechtigte Rolle.
3. Versand an Signaturprovider. Status-Updates per Webhook fließen in `signers.status` und treiben Erinnerungen.
4. Bei Decline durch externen Signer: Vertrag fällt zurück in `in_negotiation` mit Decline-Reason.
5. Bei vollständiger Signatur: Status `signed`, Audit-Hash der finalen Manifestation, Trigger Post-Signature-Routinen.

### 6.5 Post-Signature-Aktivierung

1. Status wechselt auf `active`. `effectiveFrom` wird gesetzt.
2. Aus Klauseln werden Obligations und Milestones materialisiert (aus konfigurierten `clause_variant.obligationTemplates`).
3. Order Confirmation wird erzeugt, an Customer Success / Operations übergeben.
4. Renewal Opportunity wird vorab geplant (nach `effectiveTo - renewalNoticeDays`).
5. Stakeholder werden informiert (Account Owner, CS, Finance, Legal, Brand-Verantwortliche).

### 6.6 Amendment

1. Auslöser: Kundenwunsch, Scope-Änderung, Korrektur, Renewal-Anpassung.
2. Erstellung als `contract_amendment` mit Operationen (`add`/`replace`/`remove`) auf bestehende Klauseln.
3. Eigene Verhandlungs-, Approval- und Signaturpfade analog zum Hauptvertrag.
4. Nach Signatur wird der Effective State des Vertrags neu berechnet (Endpoint `GET /contracts/:id/effective-state`).

### 6.7 Preisänderungsschreiben (Price Increase Case)

1. Voraussetzung: Vertrag enthält eine aktive Preisänderungsklausel (`clause_family = price_adjustment`) oder relevante Indexierungsklausel.
2. System erkennt Veranlasser (Kampagne, Indexwert, manueller Anstoß).
3. Pro Vertrag wird ein `price_increase_case` erzeugt mit Baseline-Preispositionen, vorgeschlagenem Uplift, Effective Date, Klauselbezug.
4. KI generiert Entwurf des Schreibens mit Begründung in Geschäftssprache, juristisch sauberem Bezug zur Klausel und in Brand-Tonalität.
5. Approval-Pfad nach Policy (z. B. ab Uplift-Schwelle X muss Finance freigeben).
6. Versand an Kunden über E-Mail-Provider mit Tracking. Versandstatus wird festgehalten.
7. Kundenreaktion (Annahme / Ablehnung / Gegenangebot) wird strukturiert erfasst (analog Negotiation Reactions).
8. Bei Annahme: Vertrag erhält Amendment für die neuen Preispositionen ab Effective Date.
9. Bei Ablehnung/Gegenangebot: Negotiation Case oder Eskalation.
10. Auswirkungen werden in Forecast und Performance-Reporting sichtbar.

### 6.8 Renewal

1. Renewal Opportunity wird vor Notice-Window aktiviert, ein Deal-Objekt entsteht im Pipeline-Status „Renewal".
2. KI berechnet Renewal Risk Score (Nutzungsdaten falls vorhanden, Verhandlungs- und Reaktionshistorie, Obligations-Erfüllung, Preisbewegungen).
3. Account Owner / CS erhält rechtzeitig Aufgabe, Renewal-Strategie zu definieren (Preisuplift, neue Laufzeit, Scope-Erweiterung).
4. Entweder Auto-Renewal greift (mit oder ohne Preisanpassung gemäß Klausel) oder es entsteht ein Renewal-Vertrag bzw. Amendment.
5. Bei aktivem Kündigungsfenster wird die Verantwortlichkeit klar zugewiesen, Eskalationen sind zeitgesteuert.

### 6.9 Kündigung / Auslauf

1. Eintritt eines Kündigungsfensters wird N Tage vorher angekündigt.
2. Kommt eine Kundenkündigung, wird sie strukturiert aufgenommen, geprüft (Frist gewahrt? Kündigungsgrund relevant?) und löst den Termination-Workflow aus.
3. Bei Auslauf ohne Verlängerung: Status `expired`, Obligations werden geschlossen oder als Restpflichten markiert.

---

## 7. AI-Architektur und AI-Funktionen

KI ist eine Schicht über den Geschäftsobjekten, keine separate Insel. Sie wird konsequent in die Workflows eingebettet, ist scope-/rights-aware, liefert strukturierte Outputs und ist auditierbar.

### 7.1 Architekturkomponenten

**AI Context Assembler.** Eine Komponente, die für eine konkrete Anfrage (z. B. „erkläre Risiko der Klausel X im Vertrag Y für Audience Sales") den Kontext zusammenstellt. Sie zieht ausschließlich Daten, die der anfragende User sehen darf. Privacy-markierte Klauseln werden je nach Recht entweder eingeblendet, maskiert oder ausgeschlossen.

**Permission Filter.** Vor jedem Kontextbau läuft eine Rechteprüfung gegen `user_scope` und Policies. Cross-Tenant-Daten sind technisch unmöglich (separate Tabellen-Scopes).

**Structured Output Layer.** Antworten werden als JSON gegen ein Zielschema gefordert (z. B. `{ riskLevel, riskCategory, summary, recommendedAction, confidence }`). Freitext gibt es nur in dafür vorgesehenen Feldern (`summary`, `rationale`).

**Explainability Layer.** Jede Empfehlung (`ai_recommendation`) hat eine zugeordnete `ai_explanation` in Geschäftssprache, die sich pro Audience (Sales/Legal/Finance/Exec) unterschiedlich formulieren lässt.

**Confidence & Quality Indicators.** Jede Empfehlung enthält ein Confidence-Maß (`low`/`medium`/`high` plus numerischer Wert), und die UI signalisiert visuell, wann eine menschliche Prüfung dringend ist.

**Human-in-the-Loop.** Keine KI-Aktion mit Außenwirkung läuft ohne menschliche Bestätigung (Versand von Schreiben, Akzeptieren von Counterproposals, Anpassen von Klauseln). KI darf vorbereiten, nicht beschließen.

**Audit Logging.** Jede KI-Anfrage wird mit Zweck, Scope, Eingangshash und Antwort-ID protokolliert. Inkl. genutzter Modellversion. Reproduzierbarkeit ist Pflicht.

**Guardrails gegen Halluzinationen.** Bei juristischen Texten werden Antworten gegen die Klauselbibliothek gegrounded; freier Text ohne Quellbezug wird gekennzeichnet (`unverified`). Quellen-IDs gehören zur Antwort.

**No-Cross-Tenant-Garantie.** Modelle und Caches sind tenant-segmentiert. Kein Embedding eines Tenants darf in einem anderen Tenant suchbar sein.

### 7.2 Funktionen pro Workspace

**Copilot im Deal Room.** Erklärt Status, schlägt nächste Aktion vor, identifiziert Risiken, weist auf inkonsistente Daten zwischen Deal/Quote/Vertrag hin.

**Copilot im Contract Workspace.** Generiert Zusammenfassung des Vertrags in Geschäftssprache, listet Abweichungen klauselscharf, schlägt zulässige Varianten vor, erklärt Approval-Bedarf.

**Copilot im Negotiation Workspace.** Analysiert Customer Reactions, vergleicht Gegenpapier mit Standard, bewertet Risiken, schlägt Counterproposals und Verhandlungsformulierungen vor, fasst Verhandlungsverlauf für Manager zusammen.

**Copilot in Approvals.** Erstellt Approver-spezifische Briefings mit Impact, Begründung, Risiko und Alternative.

**Copilot bei Price Increase Cases.** Bereitet das Schreiben vor (juristisch sauber, in Brand-Tonalität), erklärt Begründung, prognostiziert Annahmewahrscheinlichkeit und mögliche Reaktionen.

**Copilot für Renewal-Risiken.** Risk-Score plus erklärbare Faktoren, vorgeschlagene Strategie (Preisuplift, Scope-Anpassung, Schutzmaßnahmen).

**Copilot für Executive Summaries.** Aggregiert Vertragsportfolios pro Brand/Company/Region: Risiken, Open Topics, Renewals, Compliance-Lage.

### 7.3 Fähigkeiten der KI (querschnittlich)

- Verträge in Geschäftssprache zusammenfassen.
- Risiken klauselscharf erklären, mit Quellbezug auf interne Standardvariante.
- Abweichungen identifizieren, kategorisieren und klassifizieren.
- Empfohlene Klauselvarianten aus Playbook ziehen, inkl. Begründung warum.
- Zulässige Alternativen filtern (Compatibility/Incompatibility-Graph).
- Freigabebedarf erklären – wer, warum, wie hoch der Impact.
- Verkaufs-, Finanz- und Legal-Sicht in einer Antwort kombinieren, ohne sie zu vermischen.
- Offene Punkte aus Verhandlungstexten extrahieren und Verantwortlichen vorschlagen.
- Gegenpapier ↔ internes Papier mappen, Diff erklären, Risk-Score je Klausel berechnen.
- Inkonsistenzen zwischen Deal, Quote, Pricing, Approval und Vertrag erkennen.
- Preisänderungsschreiben mit Klauselbezug und Brand-Tonalität entwerfen.
- Verhandlungshistorien als Verlaufsbericht für Management aufbereiten.
- Management-Briefings über Vertragsportfolios generieren.

---

## 8. Screen-by-Screen Konzept

Die Screens setzen die existierende UI-Struktur fort (Deal Room, Contract Detail, Amendments, Negotiation Workbench, Approvals, Signatures, Order Confirmations, Clauses, Price Increases) und ergänzen die noch fehlenden Workspaces.

### 8.1 Deal Room mit Contract Summary

**Strategische Rolle.** Der Deal Room ist die Zentrale des Sales. Die Vertragssicht hier muss in fünf Sekunden sagen: gibt es einen Vertrag, in welchem Status, gibt es offene Approvals, gibt es Risiken, was ist die nächste sinnvolle Aktion.

**Hauptnutzer.** Sales Rep, Sales Manager.

**Wichtigste Informationsblöcke.** Vertragskarte (Typ, Status, Geschäftsversion, Risk-Level, nächste Aktion), Approval-Status (offene Cases mit Approver), Verhandlungsstatus (Round, offene Reactions, Wartezustand), KI-Empfehlung.

**Primäre Aktionen.** „Vertrag vorbereiten", „Verhandlung fortsetzen", „Approvals einsehen", „An Signatur senden".

**Zustände.** Kein Vertrag / Entwurf / In Verhandlung / Wartet auf Approval / Bereit für Signatur / Signiert / Aktiv / Amendment offen.

**AI-Unterstützung.** „Was sollte ich als Nächstes tun?" mit drei Vorschlägen.

**KPIs / Sichtbarkeit.** Time-to-Signature, Verhandlungsrunden, Wert.

### 8.2 Contract Workspace

**Strategische Rolle.** Hauptarbeitsbereich für die strukturierte Bearbeitung eines Vertrags – nicht ein Word-Editor, sondern eine klauselzentrierte Oberfläche.

**Hauptnutzer.** Sales Rep, Sales Manager, Legal.

**Wichtigste Informationsblöcke.** Header (Stammdaten, Status, Versionen, Brand/Company/Account), Klauselbaum (gruppiert nach Family, jede Klausel mit Severity-Badge und Variant-Auswahl), Abweichungspanel rechts (Liste mit Severity, Impact, Approval-Status), Tasks (offene Punkte), Verlauf, KI-Panel.

**Primäre Aktionen.** Klauselvariante wechseln, Klauseltext editieren (mit erforderlicher Begründung), Abweichung melden, Approval anfordern, Geschäftsversion sichern, in Verhandlung übergeben, an Signatur senden, PDF-Vorschau, Export.

**Zustände.** Draft / In Review / In Negotiation / Pending Approval / Approved / Sent for Signature / Signed / Active / Amended / Terminated.

**AI-Unterstützung.** Vertragszusammenfassung, Risiko-Übersicht, „erkläre diese Klausel", „schlage zulässige Alternative vor".

**KPIs / Sichtbarkeit.** Risk Score, Anzahl Abweichungen, offene Approvals, Time-in-Status.

**Typische Fehlerfälle.** Drift zwischen Quote und Vertrag (Banner mit Auflösungsoptionen), gesperrte Klauselvariante (klare Erklärung warum, Vorschlag zulässiger Alternative).

### 8.3 Clause / Playbook Explorer

**Strategische Rolle.** Verwaltet die Wissensbasis: Klauselfamilien, Varianten, Severity, Kompatibilitäten, Playbook-Zuordnung pro Brand/Company.

**Hauptnutzer.** Legal, Tenant Admin, Brand Admin.

**Wichtigste Informationsblöcke.** Family-Liste, Varianten-Detail (Body, Risk Notes, Required Approvals, Kompatibilitätsgraph), Playbook-Editor.

**Primäre Aktionen.** Variante anlegen/bearbeiten, Severity setzen, Kompatibilitäten pflegen, Variante in Playbook zulassen/sperren, Pflichtklausel definieren.

**KPIs.** Nutzungshäufigkeit pro Variante, Genehmigungsquote, Verhandlungswiderstand.

### 8.4 Negotiation & Counterproposal Workspace

**Strategische Rolle.** Operative Steuerung von Verhandlungen.

**Hauptnutzer.** Sales Rep, Sales Manager, Legal.

**Wichtigste Informationsblöcke.** Round-Selector mit Verlauf, Reaktionsliste pro Round, offene Punkte mit Verantwortlichkeit, Counterproposals mit Empfehlung, Diff-Ansicht (Klausel-vorher/nachher), externe Papiere mit Risk Findings.

**Primäre Aktionen.** Reaction erfassen, Counterproposal erstellen, externes Papier hochladen, Risk Finding entscheiden (akzeptieren/ablehnen/alternative/eskalieren), Verhandlung an Legal/Finance routen, Verhandlung schließen.

**AI-Unterstützung.** „Fasse Verhandlung für Manager zusammen", „erstelle Antwortvorschlag auf Reaktion", „schlage Counterproposal vor".

**KPIs.** Verhandlungsdauer, Anzahl Runden, Anteil akzeptierter Counterproposals.

### 8.5 Approval Hub

**Strategische Rolle.** Zentrale Inbox aller fälligen Entscheidungen.

**Hauptnutzer.** Sales Manager, Finance, Legal, Executive.

**Wichtigste Informationsblöcke.** Approval-Liste mit Filter (Mine, Team, Eskaliert, Überfällig), Detailansicht mit Snapshot der Abweichung, Impact, Verlauf, KI-Briefing, History des Vertrags.

**Primäre Aktionen.** Approve, Reject, Delegate, Comment, Request More Info.

**KPIs.** Time-to-Decision, Reject-Quote, Eskalationsquote.

### 8.6 Signature Center

**Strategische Rolle.** Steuerung aller Signaturprozesse, intern und extern.

**Hauptnutzer.** Sales, Legal, signaturberechtigte Manager.

**Wichtigste Informationsblöcke.** Package-Liste mit Status, Signer-Verlauf, Erinnerungs-Settings, Decline-/Bounce-Handling, Audit-Trail des Providers.

**Primäre Aktionen.** Package zusammenstellen, Reihenfolge ändern, Erinnerung senden, neu auslösen, abbrechen, Audit-Trail exportieren.

**KPIs.** Time-to-Signature, Decline-Rate, Bounce-Rate.

### 8.7 Order Confirmation & Handover Center

**Strategische Rolle.** Übergabe von Sales an Operations/CS/Finance ohne Reibungsverlust.

**Hauptnutzer.** Sales, Customer Success, Operations, Finance.

**Wichtigste Informationsblöcke.** Bestelldaten, Lieferplan, Pflichten, Verantwortlichkeiten, Abnahmechecks.

**Primäre Aktionen.** Validieren, freigeben, an nachgelagerte Systeme übergeben, Mängel melden.

### 8.8 Price Increase Center

**Strategische Rolle.** Kampagnen- und Einzelfallsteuerung von Preiserhöhungen.

**Hauptnutzer.** Sales Manager, Finance, Customer Success.

**Wichtigste Informationsblöcke.** Kampagnenliste, betroffene Verträge, Schreibensentwurf, Versandstatus, Kundenreaktionen, Annahmequote.

**Primäre Aktionen.** Kampagne anlegen, Verträge zuordnen, Schreiben generieren, freigeben, versenden, Reaktionen verarbeiten.

**KPIs.** Annahmequote, Eskalationsquote, mittlere Reaktionsdauer.

### 8.9 Reports & Performance Cockpit

**Strategische Rolle.** Strategische Sicht auf Vertragsportfolio.

**Hauptnutzer.** Sales Manager, Executive, Legal Lead, Finance Lead.

**Wichtigste Informationsblöcke.** Portfolio nach Brand/Company/Region, Risikoverteilung, Zykluszeiten, häufigste Abweichungen, Renewal-Risiken, Compliance-Lage.

**Primäre Aktionen.** Drilldown, Export, Subscribe, Filter speichern.

### 8.10 Tenant Admin Console (Vertragsteil)

**Strategische Rolle.** Konfiguration von Vertragstypen, Playbooks, Policies, Rollen, Sichtbarkeit.

**Hauptnutzer.** Tenant Admin, Company Admin.

**Wichtigste Informationsblöcke.** Vertragstypen-Verwaltung, Playbook-Editor, Policy-Builder, Rollen- und Scope-Editor, API-Tokens und Scopes.

### 8.11 Platform Admin Console (Vertragsteil)

**Strategische Rolle.** Plattformweite Beobachtung: aktive Tenants, KI-Nutzung, Modellversionen, Provider-Konfiguration für Signatur/Email.

### 8.12 Übergreifende UX-Prinzipien

- Drei Hauptbereiche pro Screen (Header, Hauptarbeitsfläche, Kontextpanel).
- Statusbadges sind farbkonsistent durch alle Screens hinweg.
- Severity-Badges (soft/standard/hard) sind global einheitlich.
- Jede automatisierte Aktion ist mit einer Erklärung versehen („Warum schlägt mir das System X vor?").
- Jede gesperrte Aktion ist mit einer Erklärung versehen („Warum darf ich das nicht?").
- Versionen sind erste-Bürger-Information (nicht in Tab versteckt).
- KI-Empfehlungen sind klar als KI-Empfehlungen markiert mit Confidence-Indikator.

---

## 9. API-Zielbild

Die API ist Tenant-skopiert, REST-basiert, versioniert (`/v1`), idempotent bei schreibenden Operationen mit `Idempotency-Key`, und respektiert vollständig Sichtbarkeit und Rechte des Tokens.

### 9.1 Sicherheits- und Scoping-Modell

**Authentifizierung.** Bearer-Token pro API Access Scope, optional mTLS für Enterprise-Integrationen.

**Token-Scope.** Pro Token: Tenant (genau einer), Companies (eine Liste oder all), Brands (eine Liste oder all), Endpoints, Read/Write, Rate Limit, Ablauf, IP-Restriktionen.

**Header-Konvention.** `X-Tenant-Id` als Pflichtheader (muss zum Token-Tenant passen). Optional `X-Company-Id`/`X-Brand-Id` zur Eingrenzung.

**Auditierbarkeit.** Jede API-Anfrage wird mit Token-ID, Endpoint, Status, Latenz und (bei Mutationen) Vorher-/Nachher-Snapshot protokolliert.

**Rate Limiting.** Pro Token konfigurierbar, mit `Retry-After` und 429-Antwort.

**Versionierung.** Pfadbasierte Versionierung (`/v1`, `/v2`). Breaking Changes erfordern neue Major-Version.

**Idempotenz.** Schreibende Endpunkte unterstützen `Idempotency-Key` und antworten bei Wiederholung deterministisch.

### 9.2 Wichtigste Endpunkte (Auszug)

**Pricing.**
- `GET /v1/price-positions` – Liste aktueller Preispositionen, filterbar nach Brand/Company/Tag.
- `GET /v1/price-books/:id` – Einzelnes Preisbuch mit Gültigkeit.

**Quotes.**
- `GET /v1/quotes/current?accountId=...` – aktuell gültiges, akzeptiertes Quote pro Account.
- `GET /v1/quotes/:id/versions` – Versionen eines Quotes.

**Contracts.**
- `GET /v1/contracts` – Liste mit Filtern (`status`, `brandId`, `companyId`, `riskLevel`, `effectiveFromBetween`).
- `GET /v1/contracts/:id` – Vertragsdetails inkl. aktueller Klauselbelegung.
- `GET /v1/contracts/:id/effective-state` – Vertragszustand inkl. aller Amendments.
- `GET /v1/contracts/:id/versions` – Versionen.
- `GET /v1/contracts/:id/clauses` – aktive Klauselbelegung.
- `POST /v1/contracts/:id/amendments` – Amendment erstellen.

**Verhandlung.**
- `POST /v1/negotiations/:id/reactions` – Customer Reaction erfassen.
- `POST /v1/negotiations/:id/counterproposals` – Counterproposal anlegen.
- `POST /v1/negotiations/:id/external-papers` – externes Papier hochladen.

**Approvals.**
- `GET /v1/approvals?status=pending` – offene Approvals im Scope.
- `POST /v1/approvals/:id/decide` – Entscheidung treffen.

**Signatur.**
- `GET /v1/signature-packages/:id` – Status und Signer.
- `POST /v1/signature-packages/:id/send-reminder` – Erinnerung senden.

**Obligations.**
- `GET /v1/obligations?status=pending&dueBefore=...` – offene Pflichten im Scope.
- `PATCH /v1/obligations/:id` – Status aktualisieren.

**Renewals.**
- `GET /v1/renewals?windowOpensBefore=...`.

**Price Increases.**
- `GET /v1/price-increase-cases?status=...`.
- `POST /v1/price-increase-cases/:id/letter` – Schreiben generieren.
- `POST /v1/price-increase-cases/:id/customer-reaction` – Kundenreaktion erfassen.

**Audit.**
- `GET /v1/audit-events?entityType=contract&entityId=...` – nur für Auditor-/Admin-Tokens.

### 9.3 Webhooks

Tenant-Admin kann pro Ereignistyp Webhooks konfigurieren: `contract.signed`, `contract.amended`, `obligation.due`, `renewal.window_opening`, `price_increase.letter_sent`, `price_increase.customer_reacted`. Webhook-Signatur per HMAC, Retry mit Exponential Backoff, Dead-Letter-Queue.

### 9.4 Typische Use Cases

- ERP fragt nach signiertem Vertrag und Pflichten zur Auftragserfassung.
- Billing fragt nach gültigem Quote und akzeptierten Preispositionen für Abrechnung.
- BI-Tool zieht Audit Events und Vertragsstatus für Reporting.
- Customer Portal liest aktuelle Vertragsdaten für den Kunden (mit Customer-spezifischem Token).

---

## 10. Compliance / Security / Audit

### 10.1 Mandantentrennung

Jede Abfrage gegen die Datenbank wird durch einen verpflichtenden Tenant-Filter geschützt (Application-Layer). Ergänzend Row-Level-Security in Postgres. Backups, Exporte, Search-Indizes, KI-Embeddings und Caches sind tenant-segmentiert.

### 10.2 Granulare Zugriffskontrollen

Jede Read- und Write-Operation prüft `user_scope` (Companies, Brands), `role`-Permissions und Klauselsensitivität (`privacy = true`). Cross-Tenant-Leaks sind strukturell ausgeschlossen.

### 10.3 Audit Trail

Universeller `audit_event`-Stream. Pflichtfelder: Tenant, Akteur, Rolle, Ziel-Entity, Aktion, Vorher-/Nachher-Snapshot, ggf. Policy- und KI-Bezug. Audit-Daten sind unveränderlich und retention-pflichtig.

### 10.4 Lösch- und Aufbewahrungsregeln

`data_retention_rule` pro Tenant, Vertragstyp, Brand, Region. Automatische Pseudonymisierung personenbezogener Daten in Verträgen nach Auslauf der Frist (z. B. Kontaktnamen anonymisieren, Adresse vergröbern). Vertragstexte und Audit-Events bleiben länger erhalten als personenbezogene Begleitdaten.

### 10.5 Datensparsame KI-Kontextbildung

Der AI Context Assembler übergibt nur die Felder, die für die konkrete Anfrage notwendig sind. Privacy-Klauseln werden nur eingebunden, wenn der User `clause.privacy.read` hat. Personenbezogene Daten werden, wo möglich, durch Platzhalter ersetzt.

### 10.6 Protokollierung kritischer Entscheidungen

Approvals, Signaturversand, KI-getriebene Entwürfe für Außenkommunikation und manuelle Übersteuerungen von Empfehlungen sind besonders markierte Audit-Events.

### 10.7 Schutz sensibler Vertragsdaten

Verschlüsselung at-rest (DB, Object Storage) und in-transit (TLS). Anhänge werden tenant-isoliert in eigenen Pfaden gespeichert. Download-Links sind kurzlebig und tokenisiert.

### 10.8 Export- und Download-Restriktionen

Export ist eigene Permission. Bulk-Exports werden auditiert, optional mit verzögertem Download (Vier-Augen-Prinzip möglich).

### 10.9 Rechte auf personenbezogene Daten (DSGVO)

Auskunfts-, Berichtigungs-, Löschrechte werden über DPO-Workflow realisiert. Verträge mit personenbezogenen Daten können selektiv pseudonymisiert werden, ohne den geschäftlichen Vertragstext zu verlieren.

### 10.10 Data Residency

Pro Tenant konfigurierbar (EU/US/AP). Tenant-Daten werden in der gewählten Region verarbeitet und gespeichert, KI-Modelle ebenfalls regionalisiert.

### 10.11 Admin-Audits

Tenant Admin hat Live-Sicht auf User-Aktivität (z. B. wer hat welchen Vertrag exportiert). Auditor-Rolle hat Read-only-Zugriff über alles.

### 10.12 Revisionsfähigkeit

Jeder Vertrag kann zu einem beliebigen Zeitpunkt rekonstruiert werden (effektive Klauselbelegung, Werte, Approvals, KI-Empfehlungen, manuelle Eingriffe).

---

## 11. KPI- und Reporting-Framework

### 11.1 Operative KPIs

- **Time-to-Signature** (Quote akzeptiert → Vertrag signiert).
- **Verhandlungsdauer** (Verhandlungsstart → Verhandlungsabschluss).
- **Time-to-Approval** je Approver-Rolle.
- **Anzahl Verhandlungsrunden** im Mittel und im Worst Case.
- **Anteil Standard-Pfad** (Verträge ohne Abweichung in Prozent).
- **Anteil Soft/Standard/Hard** je Klauseltyp.
- **Häufigste Klauselabweichungen** (Top-N-Liste).
- **Häufigste Eskalationsgründe**.

### 11.2 Risiko- und Compliance-KPIs

- **Riskoverteilung** nach Brand/Company/Region/Segment.
- **Anteil Verträge außerhalb Standard**.
- **Compliance-relevante Abweichungen** (z. B. DPA modifiziert).
- **Pipeline mit hohem Vertragsrisiko**.

### 11.3 Lifecycle-KPIs

- **Renewal-Risiko**.
- **Renewal-Quote** und **Auto-Renewal-Quote**.
- **Annahmequote von Preisänderungen**.
- **Erfüllungsgrad Obligations**.
- **Anzahl überfälliger Pflichten**.

### 11.4 Performance-KPIs (Sales-individuell)

- **Sales-to-Signature-Conversion** je Rep / Team / Brand.
- **Mittlere Verhandlungslast** pro Rep.
- **Mittlere KI-Empfehlung-Akzeptanzquote** pro Rep.

### 11.5 Dashboards pro Rolle

- **Sales Rep:** Eigene Pipeline, eigene offene Approvals, eigene fällige Pflichten, eigene Renewal-Aufgaben.
- **Sales Manager:** Team-Pipeline, Team-Approvals, Team-Risiken, Verhandlungs-Hotspots.
- **Legal:** Klauselabweichungen, Hard-Klausel-Editierungen, hängende Legal-Approvals, Risk-Findings aus Gegenpapieren.
- **Finance:** Discounts vs. Schwellen, Margenverstöße, Preisänderungs-Annahmequote, Outstanding Approvals Finance.
- **Executive:** Portfolio-Risiko, Renewal-Risiken, Anteil Standard, KPI-Trends.
- **Customer Success:** Account-Pflichten, Renewals, Eskalationen, NPS-Korrelation falls vorhanden.
- **Compliance/DPO:** Privacy-relevante Abweichungen, ausstehende Löschungen, Zugriffsanomalien.

---

## 12. Roadmap

Die Reihenfolge ist so gewählt, dass jede Stufe eigenständig produktiv nutzbar ist und auf der vorigen aufbaut.

### MVP (Quartal 1)

- Domänenobjekte ausbauen: `contract` um Multi-Brand/Company-Felder, `clause_deviation`, `obligation`, `audit_event`.
- Vertragserstellung aus Quote mit Vertragstyp + Standard-Playbook + Standardklauseln.
- Klauseln über `contract_clauses` mit Variant-Wahl (vorhanden) – Severity- und Approval-Hinweis.
- Einfache Deviation-Engine (regelbasiert: Discount-Schwelle, Zahlungsziel, Auto-Renewal-Toggle, DPA-Modifikation).
- Approval-Cases mit Single-Step-Routing.
- Signature Package mit zwei Providern (Mock + ein echter Provider) und externem Signer-Workflow.
- Contract Workspace mit Klauselbaum + Abweichungspanel + Versionierung (vorhanden) + PDF-Vorschau.
- Negotiation Workbench: Customer Reactions erfassen, Counterproposals anlegen, Diff zwischen Klauselvarianten.
- Obligations: aus Klauselvarianten Obligation-Templates ableiten, Liste je Vertrag und je Account.
- API v1: `contracts`, `contracts/:id/effective-state`, `quotes/current`, `price-positions`, `obligations`.
- Audit Trail (write-only Stream) auf alle relevanten Aktionen.
- Rechtemodell: Tenant Admin, Sales Rep, Sales Manager, Legal, Finance, Approver, Auditor; Scope auf Tenant und Company.
- KI-Funktionen MVP: Vertragszusammenfassung, Klauselerklärung, Approval-Briefing, Counterproposal-Vorschlag.
- Standard-KPIs: Time-to-Signature, Anzahl Abweichungen, Approval-Durchlaufzeit.

### Phase 2 (Quartal 2)

- Brand-Scope vollständig im Rechtemodell und in allen Filtern, Suche, Reporting und API.
- Policy-Builder im Tenant-Admin (regelbasierte Approval-Auslösung, Sperrung von Klauselvarianten je Brand/Company).
- Mehrstufige Approvals mit Delegation und Stellvertretung.
- Externe Vertragspapiere: Upload, Parsing, Klausel-Mapping, Risk-Findings, KI-Empfehlung pro Finding.
- Amendment-Workflow vollständig (Amendments mit eigenem Approval-/Signaturpfad, Effective-State-Berechnung).
- Renewal-Engine: automatische Generierung von Renewal Opportunities, Renewal-Risk-Score, Pipeline-Integration.
- Price Increase Cases vollständig (Schreibensgenerierung, Versand, Tracking, Reaktion).
- Webhooks für Vertrags-, Signatur- und Renewal-Events.
- KI-Erweiterungen: Verhandlungs-Zusammenfassung für Manager, Renewal-Risk-Erklärung, Preisänderungsschreiben-Generator, Konsistenzprüfung Quote ↔ Vertrag.
- Reports & Performance Cockpit mit Drilldown und gespeicherten Filtern.

### Phase 3 (Quartal 3)

- Volle Multi-Brand-Klauselbibliothek mit brand-spezifischen Varianten und Tonalität.
- Compatibility-/Incompatibility-Graph für Klauselvarianten in der UI sichtbar.
- Konfigurierbare Obligation-Eskalation (Eskalationsbäume, automatische Aufgaben).
- Custom Contract Types und Custom Playbooks pro Tenant.
- Erweiterte Suche über Klauselinhalte (Hybrid: strukturiert + semantisch, tenant-segmentiert).
- AI-Confidence-Indikatoren überall, Quality-Score von Empfehlungen, Feedback-Loop von Nutzerentscheidungen ins Modell.
- Externe Mitwirkende (zeitlich begrenzte Magic-Links für Anwälte/Berater).
- Erweiterte API: Webhooks-UI, Token-Management mit IP-Restriktionen, OAuth-Client-Credentials für Partnerintegrationen.
- DPO-Cockpit für DSGVO-Aufgaben.

### Enterprise-Ausbau (Quartal 4 und später)

- Data Residency multi-region (EU/US/AP), regional segmentierte KI-Modelle.
- Bring-your-own-eSign (mehrere Provider parallel, konfigurierbar pro Brand/Region).
- Verhandlungs-Cockpit mit Real-Time-Collaboration (mehrere User gleichzeitig im Workspace).
- Vertragsmigration: Bulk-Import aus Bestandssystemen mit KI-gestütztem Mapping auf Klauselbibliothek.
- Custom-Risk-Scoring-Modelle pro Tenant.
- Marketplace für Klausel-Pakete (z. B. branchenspezifische Standards).
- SOC2/ISO-27001-Reife der Auditspur und Operationalisierung.

---

## 13. Done Criteria / Erfolgsmaßstäbe

Das Vertragswesen ist „best in class", wenn alle folgenden Maßstäbe gleichzeitig erreicht sind:

**Geschäftliche Wirksamkeit.**
- Mindestens 70 % der Verträge entstehen ohne manuelles Eingreifen aus Quote + Playbook.
- Time-to-Signature sinkt im Vergleich zur Vorversion um mindestens 40 %.
- Mindestens 60 % der Vertragsabweichungen werden automatisch erkannt und korrekt klassifiziert.
- Annahmequote von Preisänderungsschreiben ist messbar und durch KI-Vorbereitung steigerbar.
- Renewal-Quote ist messbar und durch Renewal-Risk-Score frühzeitig steuerbar.

**Operative Reibung.**
- Sales kann eine Standardverhandlung ohne Legal-Eingriff zu Ende führen.
- Legal greift nur dort ein, wo Hard-Klauseln berührt werden.
- Finance entscheidet Approvals mit klarer Impact-Sicht ohne Recherche.
- Customer Success sieht Pflichten und Renewals proaktiv, nicht reaktiv.
- Manager haben jederzeit Portfolio-Sicht ohne SQL-Anfragen.

**Steuerbarkeit nach Signatur.**
- 100 % der vertraglichen Pflichten mit Fristen erzeugen Obligations.
- Kein Renewal wird übersehen, jede Renewal Opportunity hat einen Verantwortlichen.
- Auto-Renewals sind transparent, kein Auto-Renewal geschieht unbemerkt.
- Jede Preisänderung folgt einem strukturierten Prozess mit nachvollziehbarer Begründung.

**Risiko- und Auditfähigkeit.**
- Jede signifikante Aktion auf einem Vertrag ist im Audit Trail rekonstruierbar.
- Risk Score eines Vertrags ist erklärbar (Welche Klauseln, welche Abweichungen, welche Policies).
- DSGVO-Anfragen werden in vertretbarer Zeit (Tage, nicht Wochen) bedient.

**Multi-Tenant-/Brand-Sicherheit.**
- Kein User sieht Daten außerhalb seines Scopes – auch die KI nicht.
- Kein API-Token exfiltriert Daten außerhalb seines Scopes.
- Tenant Admin kann jede Sichtbarkeitsänderung zurückverfolgen.

**KI-Nutzwert.**
- KI-Empfehlungen haben eine messbar hohe Akzeptanzquote (Ziel > 60 % bei mittlerer/hoher Confidence).
- KI-Erklärungen werden von Approvern als entscheidungsrelevant bewertet.
- Cross-Tenant-Kontamination ist ausgeschlossen und wird durch Tests laufend verifiziert.

**User Acceptance.**
- Vertragsbearbeitung ist ohne Schulung möglich (Onboarding mit Hilfeebene reicht).
- Standardpfad ist in unter 5 Minuten vom Quote zum unterschriftsreifen Entwurf bedienbar.
- Hilfetexte und Glossar sind kontextuell verfügbar (siehe FieldHint-Pattern und PageHelpDrawer).

**Plattformreife.**
- Audit, Backup, Restore und Migration sind getestet.
- API ist versioniert, idempotent, scope-sicher und auditierbar.
- Lasttests bestätigen Skalierbarkeit über mindestens 100k Verträge je Tenant ohne UX-Degradierung.

Wenn diese Kriterien gemeinsam erreicht sind, ist DealFlow One in einem Marktbereich angekommen, in dem klassische CLM-, CRM- und reine eSign-Tools strukturell nicht mithalten können – weil dort der Vertrag entweder nur ein Dokument oder nur ein Anhang am Deal ist, während er in DealFlow One der zentrale, strukturierte, lebendige Wahrheitsträger des kommerziellen Geschäfts ist.
