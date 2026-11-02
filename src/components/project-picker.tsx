"use client";

import { usePathname, useRouter } from "next/navigation";
import { fieldClass } from "@/components/kit";

/** Project scope lives in the URL, so links and refreshes keep it. */
export function ProjectPicker({ projects, current }: { projects: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="w-56">
      <label htmlFor="project-picker" className="sr-only">
        Project
      </label>
      <select
        id="project-picker"
        className={fieldClass}
        value={current ?? ""}
        onChange={(event) => router.push(event.target.value ? `${pathname}?project=${event.target.value}` : pathname)}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}
