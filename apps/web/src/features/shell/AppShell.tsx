import type { AdminTab, AuthenticatedMe, MainTab, Pagination, PendingAttachment, PostItem, PostsTab, TenantMetadata } from "@/types/app";
import type { NavItem } from "@/lib/app-model";
import { AdminPage } from "@/features/admin/AdminPage";
import { PostPage } from "@/features/posts/PostPage";
import { PostsPage } from "@/features/posts/PostsPage";
import { StatsPage } from "@/features/stats/StatsPage";
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
  dataLoading,
  postText,
  postsTab,
  postsPagination,
  anonymous,
  pendingAttachments,
  onActiveTabChange,
  onAdminTabChange,
  onAnonymousChange,
  onFilesSelected,
  onLogout,
  onOpenOps,
  onSelectTenant,
  onPostTextChange,
  onPostsTabChange,
  onPostsPageChange,
  onRefreshTenantData,
  onRefreshMe,
  adminUserDetailTarget,
  onOpenAdminUserDetail,
  onAdminUserDetailTargetConsumed,
  onOpenPostDetailFromAdmin,
  onRemoveAttachment,
  onSubmitPost,
}: {
  activeTab: MainTab;
  adminTab: AdminTab;
  me: AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> };
  navItems: NavItem[];
  metadata: TenantMetadata;
  posts: PostItem[];
  busy: boolean;
  dataLoading: boolean;
  postText: string;
  postsTab: PostsTab;
  postsPagination: Pagination;
  anonymous: boolean;
  pendingAttachments: PendingAttachment[];
  onActiveTabChange: (tab: MainTab) => void;
  onAdminTabChange: (tab: AdminTab) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: ArrayLike<File> | null) => void;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  onSelectTenant: (tenantId: string) => Promise<void>;
  onPostTextChange: (value: string) => void;
  onPostsTabChange: (tab: PostsTab) => void;
  onPostsPageChange: (page: number) => void;
  onRefreshTenantData: () => Promise<void>;
  onRefreshMe: () => Promise<void>;
  adminUserDetailTarget: { userId: string; nonce: number } | null;
  onOpenAdminUserDetail: (userId: string) => void;
  onAdminUserDetailTargetConsumed: () => void;
  onOpenPostDetailFromAdmin: (post: { id: string; displayId: number; status: string }) => void;
  onRemoveAttachment: (id: string) => void;
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
          onSelectTenant={onSelectTenant}
        />

        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background md:mx-auto md:max-w-[980px] md:border-x md:border-slate-200">
          <Header me={me} selectedTenant={me.currentTenant} onLogout={onLogout} onOpenOps={onOpenOps} onSelectTenant={onSelectTenant} />

          <main className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value="post" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <PostPage
                busy={busy}
                loading={dataLoading}
                metadata={metadata}
                postText={postText}
                anonymous={anonymous}
                selectedTenant={me.currentTenant}
                pendingAttachments={pendingAttachments}
                onAnonymousChange={onAnonymousChange}
                onFilesSelected={onFilesSelected}
                onPostTextChange={onPostTextChange}
                onSubmit={onSubmitPost}
                onRemoveAttachment={onRemoveAttachment}
              />
            </TabsContent>

            <TabsContent value="posts" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <PostsPage
                tenantId={me.currentTenant.id}
                posts={posts}
                currentRole={me.currentMembership.role}
                activeTab={postsTab}
                minePagination={postsPagination}
                mineLoading={dataLoading}
                onMinePageChange={onPostsPageChange}
                onTabChange={onPostsTabChange}
                onRefresh={onRefreshTenantData}
              />
            </TabsContent>

            <TabsContent value="services" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <ServicesPage me={me} metadata={metadata} loading={dataLoading} onProfileSaved={onRefreshMe} />
            </TabsContent>

            <TabsContent value="stats" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <StatsPage tenantId={me.currentTenant.id} loading={dataLoading} currentRole={me.currentMembership.role} onOpenUserDetail={onOpenAdminUserDetail} />
            </TabsContent>

            <TabsContent value="admin" className="m-0 flex h-full min-h-0 flex-col overflow-hidden">
              <AdminPage
                activeTab={adminTab}
                selectedTenant={me.currentTenant}
                metadata={metadata}
                detailTarget={adminUserDetailTarget}
                onDetailTargetConsumed={onAdminUserDetailTargetConsumed}
                onTabChange={onAdminTabChange}
                onOpenPostDetail={onOpenPostDetailFromAdmin}
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
