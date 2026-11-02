import { PageBody, PageHeader, Panel, StatusPill } from "@/components/kit";

export const metadata = { title: "Connected Accounts" };

const PLATFORMS = [
  { name: "Instagram Reels", requirement: "Needs an Instagram professional account linked to a Facebook Page, and Meta app review for content publishing.", api: "Instagram Graph API" },
  { name: "Facebook Reels", requirement: "Needs a Facebook Page you manage, and Meta app review for Page publishing.", api: "Pages Video Reels API" },
  { name: "YouTube Shorts", requirement: "Needs Google OAuth. Unverified apps upload as private until the API audit passes.", api: "YouTube Data API videos.insert" },
];

export default function AccountsPage() {
  return (
    <>
      <PageHeader title="Connected Accounts" description="Publishing through official APIs arrives in Phase 2. Until then, export MP4s from Published Videos." />
      <PageBody>
        <div className="grid gap-3 lg:grid-cols-3">
          {PLATFORMS.map((platform) => (
            <Panel key={platform.name} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-medium">{platform.name}</h2>
                <StatusPill>Phase 2</StatusPill>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{platform.requirement}</p>
              <p className="readout mt-3 text-xs text-muted-foreground">{platform.api}</p>
            </Panel>
          ))}
        </div>
      </PageBody>
    </>
  );
}
