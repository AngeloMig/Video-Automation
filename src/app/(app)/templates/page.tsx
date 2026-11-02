import { PageBody, PageHeader } from "@/components/kit";
import { TemplateGallery } from "@/components/template-gallery";

export const metadata = { title: "Templates" };

export default function TemplatesPage() {
  return (
    <>
      <PageHeader title="Templates" description="A template sets caption style, pacing and transitions. Choose one in each project's settings." />
      <PageBody>
        <TemplateGallery />
      </PageBody>
    </>
  );
}
