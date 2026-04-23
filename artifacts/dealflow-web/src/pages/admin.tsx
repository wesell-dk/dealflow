import { useGetTenant, useListCompanies, useListBrands, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Settings, Shield, Building2, Users } from "lucide-react";

export default function Admin() {
  const { data: tenant, isLoading: isLoadingTenant } = useGetTenant();
  const { data: companies, isLoading: isLoadingCompanies } = useListCompanies();
  const { data: brands, isLoading: isLoadingBrands } = useListBrands();
  const { data: users, isLoading: isLoadingUsers } = useListUsers();

  const isLoading = isLoadingTenant || isLoadingCompanies || isLoadingBrands || isLoadingUsers;

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[800px] w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-muted rounded-lg">
          <Settings className="h-6 w-6 text-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground mt-1">Manage tenant settings, companies, and users.</p>
        </div>
      </div>

      {tenant && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Tenant Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
              <div>
                <div className="text-sm text-muted-foreground">Tenant Name</div>
                <div className="font-medium text-lg">{tenant.name}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Plan</div>
                <div className="font-medium"><Badge variant="outline">{tenant.plan}</Badge></div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Region</div>
                <div className="font-medium">{tenant.region}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Created</div>
                <div className="font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>Companies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Legal Entity</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Currency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies?.map(company => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell className="text-muted-foreground">{company.legalName}</TableCell>
                      <TableCell>{company.country}</TableCell>
                      <TableCell>{company.currency}</TableCell>
                    </TableRow>
                  ))}
                  {!companies?.length && (
                    <TableRow><TableCell colSpan={4} className="text-center h-16">No companies configured</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <div className="flex space-x-[-8px]">
              <div className="h-5 w-5 rounded-full bg-blue-500 ring-2 ring-background"></div>
              <div className="h-5 w-5 rounded-full bg-red-500 ring-2 ring-background"></div>
            </div>
            <CardTitle>Brands</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Parent Company</TableHead>
                    <TableHead>Voice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands?.map(brand => (
                    <TableRow key={brand.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: brand.color }}></div>
                          <span className="font-medium">{brand.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{brand.companyId}</TableCell>
                      <TableCell><Badge variant="secondary">{brand.voice}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {!brands?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center h-16">No brands configured</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>User Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback style={{ backgroundColor: user.avatarColor || 'var(--primary)', color: 'white' }}>
                            {user.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium leading-none">{user.name}</span>
                          <span className="text-xs text-muted-foreground mt-1">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{user.role}</Badge></TableCell>
                    <TableCell><span className="text-sm text-muted-foreground">{user.scope}</span></TableCell>
                  </TableRow>
                ))}
                {!users?.length && (
                  <TableRow><TableCell colSpan={3} className="text-center h-24">No users found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
