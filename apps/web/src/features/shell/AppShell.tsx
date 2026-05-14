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
  error,
  notice,
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
  error: string;
  notice: string;
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
    <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as MainTab)} className="min-h-dvh md:h-dvh">
      <div className="min-h-dvh bg-background md:flex md:h-dvh md:overflow-hidden">
        <DesktopSidebar
          activeTab={activeTab}
          me={me}
          navItems={navItems}
          selectedTenant={me.currentTenant}
          onLogout={onLogout}
          onOpenOps={onOpenOps}
        />

        <div className="min-h-dvh w-full bg-background pb-24 md:mx-auto md:h-dvh md:max-w-[980px] md:overflow-y-auto md:border-x md:border-slate-200 md:pb-8">
          <Header me={me} selectedTenant={me.currentTenant} onLogout={onLogout} onOpenOps={onOpenOps} />

          <main>
            <TabsContent value="post" className="m-0">
              <PostPage
                busy={busy}
                error={error}
                metadata={metadata}
                notice={notice}
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

            <TabsContent value="posts" className="m-0">
              <PostsPage posts={posts} currentRole={me.currentMembership.role} activeTab={postsTab} onTabChange={onPostsTabChange} onRefresh={onRefreshTenantData} />
            </TabsContent>

            <TabsContent value="services" className="m-0">
              <ServicesPage metadata={metadata} />
            </TabsContent>

            <TabsContent value="admin" className="m-0">
              <AdminPage
                activeTab={adminTab}
                currentRole={me.currentMembership.role}
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
