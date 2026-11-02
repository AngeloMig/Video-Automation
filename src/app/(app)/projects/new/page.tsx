import { PageBody, PageHeader } from "@/components/kit";
import { ProjectForm } from "@/components/project-form";

export const metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="New content project" description="A project is one niche, brand or channel, with its own queue, branding and results." />
      <PageBody className="max-w-4xl">
        <ProjectForm />
      </PageBody>
    </>
  );
}
