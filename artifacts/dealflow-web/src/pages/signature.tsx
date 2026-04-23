import { useRoute } from "wouter";
import { useGetSignaturePackage } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Check, Clock, User, Mail } from "lucide-react";
import { format } from "date-fns";

export default function SignatureDetail() {
  const [, params] = useRoute("/signatures/:id");
  const id = params?.id as string;
  const { data: pkg, isLoading } = useGetSignaturePackage(id ?? "");

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!pkg) return <div className="p-8">Signature package not found</div>;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <div className="flex flex-col gap-2 border-b pb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{pkg.title}</h1>
          <Badge variant={pkg.status === "completed" ? "secondary" : "default"} className="text-sm px-3 py-1">
            {pkg.status}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground mt-2">
          <span className="font-medium text-foreground">{pkg.dealName}</span>
          <span>&bull;</span>
          <span>Deadline: {pkg.deadline ? format(new Date(pkg.deadline), "PP") : "None"}</span>
        </div>
        
        <div className="mt-6 bg-card border rounded-lg p-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium mb-1 text-muted-foreground">Signature Progress</div>
            <div className="text-3xl font-bold">{pkg.signedCount} <span className="text-xl text-muted-foreground font-normal">/ {pkg.totalSigners}</span></div>
          </div>
          <div className="w-1/2">
            <Progress value={(pkg.signedCount / pkg.totalSigners) * 100} className="h-3" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold mb-4">Signers</h3>
        
        <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[1.5rem] md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border">
          {pkg.signers?.sort((a,b) => a.order - b.order).map((signer) => (
            <div key={signer.id} className="relative flex items-start gap-6">
              <div className={`mt-1 flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background z-10 shrink-0 ${signer.status === "signed" ? "border-green-500 text-green-500" : "border-muted-foreground text-muted-foreground"}`}>
                {signer.status === "signed" ? <Check className="w-5 h-5" /> : <span>{signer.order}</span>}
              </div>
              <Card className={`flex-1 ${signer.status === "signed" ? "border-green-500/20 bg-green-500/5" : ""}`}>
                <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{signer.name}</span>
                      <Badge variant="outline" className="text-xs">{signer.role}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {signer.email}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm">
                    {signer.status === "signed" ? (
                      <div className="flex items-center gap-1.5 text-green-600 font-medium">
                        <Check className="w-4 h-4" />
                        Signed on {signer.signedAt ? format(new Date(signer.signedAt), "MMM d, h:mm a") : "Unknown"}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        Pending
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
