import { useTranslation } from "react-i18next";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";

export default function Leads() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("nav.leads")}
        subtitle={t("pages.leads.subtitle")}
        icon={UserPlus}
        testId="page-leads-header"
      />
      <EmptyStateCard
        icon={UserPlus}
        title={t("pages.leads.emptyTitle")}
        body={t("pages.leads.emptyBody")}
        testId="page-leads-empty"
      />
    </div>
  );
}
