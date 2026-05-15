import type { AdminTab, AuthenticatedMe, MainTab, PostItem, PostsTab, TenantMetadata, UploadedImage } from "@/types/app";
import type { NavItem } from "@/lib/app-model";
import { AdminPage } from "@/features/admin/AdminPage";
import { PostPage } from "@/features/posts/PostPage";
import { PostsPage } from "@/features/posts/PostsPage";
import { ServicesPage } from "@/features/services/ServicesPage";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DesktopSidebar } from "./DesktopSidebar";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";

export function AppShell({
  activeTab,
  adminTab,
  me,
  navItems,
  metadata,
  posts,
  busy,
  postText,
  postsTab,
  anonymous,
  uploadedImages,
  onActiveTabChange,
  onAdminTabChange,
  onAnonymousChange,
  onFilesSelected,
  onLogout,
  onOpenOps,
  onPostTextChange,
  onPostsTabChange,
  onRefreshTenantData,
  onRefreshMe,
  onRemoveImage,
  onSubmitPost,
}: {
  activeTab: MainTab;
  adminTab: AdminTab;
  me: AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> };
  navItems: NavItem[];
  metadata: TenantMetadata;
  posts: PostItem[];
  busy: boolean;
  postText: string;
  postsTab: PostsTab;
  anonymous: boolean;
  uploadedImages: UploadedImage[];
  onActiveTabChange: (tab: MainTab) => void;
  onAdminTabChange: (tab: AdminTab) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: FileList | null) => void;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  onPostTextChange: (value: string) => void;
  onPostsTabChange: (tab: PostsTab) => void;
  onRefreshTenantData: () => Promise<void>;
  onRefreshMe: () => Promise<void>;
  onRemoveImage: (key: string) => void;
  onSubmitPost: () => void;
}) {
  return (
    <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as MainTab)} className="h-dvh overflow-hidden">
      <div className="h-dvh overflow-hidden bg-background md:flex">
        <DesktopSidebar
          activeTab={activeTab}
          me={me}
          navItems={navItems}
          selectedTenant={me.currentTenant}
          onLogout={onLogout}
          onOpenOps={onOpenOps}
        />

        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background md:mx-auto md:max-w-[980px] md:border-x md:border-slate-200">
          <Header me={me} selectedTenant={me.currentTenant} onLogout={onLogout} onOpenOps={onOpenOps} />

          <main className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value="post" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <PostPage
                busy={busy}
                metadata={metadata}
                postText={postText}
                anonymous={anonymous}
                selectedTenant={me.currentTenant}
                uploadedImages={uploadedImages}
                onAnonymousChange={onAnonymousChange}
                onFilesSelected={onFilesSelected}
                onPostTextChange={onPostTextChange}
                onSubmit={onSubmitPost}
                onRemoveImage={onRemoveImage}
              />
            </TabsContent>

            <TabsContent value="posts" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <PostsPage posts={posts} currentRole={me.currentMembership.role} activeTab={postsTab} onTabChange={onPostsTabChange} onRefresh={onRefreshTenantData} />
            </TabsContent>

            <TabsContent value="services" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <ServicesPage metadata={metadata} />
            </TabsContent>

            <TabsContent value="admin" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <AdminPage
                activeTab={adminTab}
                selectedTenant={me.currentTenant}
                metadata={metadata}
                onTabChange={onAdminTabChange}
                onSaved={async () => {
                  await Promise.all([onRefreshMe(), onRefreshTenantData()]);
                }}
              />
            </TabsContent>
          </main>
        </div>
      </div>

      <MobileTabBar navItems={navItems} />
    </Tabs>
  );
}
