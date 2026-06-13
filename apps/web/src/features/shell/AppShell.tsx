import type { AdminTab, AuthenticatedMe, MainTab, Pagination, PendingAttachment, PostItem, PostsTab, TenantMetadata } from "@/types/app";
import type { NavItem } from "@/lib/app-model";
import { AdminPage } from "@/features/admin/AdminPage";
import { AiPage } from "@/features/ai/AiPage";
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
  postBgColor,
  postTextColor,
  postFont,
  postsTab,
  postsPagination,
  anonymous,
  pendingAttachments,
  onActiveTabChange,
  onAdminTabChange,
  onAnonymousChange,
  onBgColorChange,
  onTextColorChange,
  onFontChange,
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
  postBgColor: string;
  postTextColor: string;
  postFont: string;
  postsTab: PostsTab;
  postsPagination: Pagination;
  anonymous: boolean;
  pendingAttachments: PendingAttachment[];
  onActiveTabChange: (tab: MainTab) => void;
  onAdminTabChange: (tab: AdminTab) => void;
  onAnonymousChange: (value: boolean) => void;
  onBgColorChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
  onFontChange: (value: string) => void;
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

        <div className={`flex h-dvh w-full flex-col overflow-hidden bg-background ${activeTab === "ai" ? "md:max-w-none" : "md:mx-auto md:max-w-[980px] md:border-x md:border-slate-200"}`}>
          <Header me={me} selectedTenant={me.currentTenant} onLogout={onLogout} onOpenOps={onOpenOps} onSelectTenant={onSelectTenant} />

          <main className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value="post" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
              <PostPage
                busy={busy}
                loading={dataLoading}
                metadata={metadata}
                postText={postText}
                postBgColor={postBgColor}
                postTextColor={postTextColor}
                postFont={postFont}
                anonymous={anonymous}
                selectedTenant={me.currentTenant}
                pendingAttachments={pendingAttachments}
                onAnonymousChange={onAnonymousChange}
                onBgColorChange={onBgColorChange}
                onTextColorChange={onTextColorChange}
                onFontChange={onFontChange}
                onFilesSelected={onFilesSelected}
                onPostTextChange={onPostTextChange}
                onSubmit={onSubmitPost}
                onRemoveAttachment={onRemoveAttachment}
              />
            </TabsContent>

            <TabsContent value="posts" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
              <PostsPage
                tenantId={me.currentTenant.id}
                posts={posts}
                currentRole={me.currentMembership.role}
                activeTab={postsTab}
                minePagination={postsPagination}
                mineLoading={dataLoading}
                autoFollowOwnPosts={me.user.autoFollowOwnPosts}
                enableMarkdownRender={metadata.enableMarkdownRender}
                onMinePageChange={onPostsPageChange}
                onTabChange={onPostsTabChange}
                onRefresh={onRefreshTenantData}
                onRefreshMe={onRefreshMe}
              />
            </TabsContent>

            <TabsContent value="services" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
              <ServicesPage me={me} metadata={metadata} loading={dataLoading} onProfileSaved={onRefreshMe} />
            </TabsContent>

            <TabsContent value="ai" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
              <AiPage me={me} />
            </TabsContent>

            <TabsContent value="stats" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
              <StatsPage tenantId={me.currentTenant.id} loading={dataLoading} currentRole={me.currentMembership.role} onOpenUserDetail={onOpenAdminUserDetail} />
            </TabsContent>

            <TabsContent value="admin" forceMount className="m-0 flex h-full min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
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
