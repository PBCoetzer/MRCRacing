import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type InfoPageProps = {
  badge: string;
  title: string;
  description: string;
  sections: { title: string; body: string }[];
};

export function InfoPage({ badge, title, description, sections }: InfoPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <Badge variant="outline" className="border-brand-cyan/50 text-brand-cyan">{badge}</Badge>
        <h1 className="mt-4 font-heading text-4xl font-normal tracking-normal text-white">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">{description}</p>
        <div className="mt-8 grid gap-4">
          {sections.map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-7 text-muted-foreground">{section.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
