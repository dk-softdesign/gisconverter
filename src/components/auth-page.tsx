import { AppHeader } from "#/components/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";

// Shared frame for the signed-out pages (login, first-run setup, invite).
export function AuthPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <AppHeader user={null} />
      <main className="flex justify-center px-4 py-12 sm:py-20">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
    </>
  );
}
