import { useEffect, useMemo, useState } from "react";
import {
  BookOpenIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  HomeIcon,
  ImagePlusIcon,
  KeyRoundIcon,
  LogOutIcon,
  MegaphoneIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import type { TenantSummary } from "@campux/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type MainTab = "post" | "posts" | "services" | "admin";

const navItems = [
  { value: "post", label: "投稿", emoji: "📝", icon: HomeIcon },
  { value: "posts", label: "稿件", emoji: "🌏", icon: ClipboardListIcon },
  { value: "services", label: "服务", emoji: "🛠", icon: SparklesIcon },
  { value: "admin", label: "管理", emoji: "🔐", icon: ShieldCheckIcon },
] satisfies Array<{ value: MainTab; label: string; emoji: string; icon: typeof HomeIcon }>;

const rules = [
  "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
  "寻物招领请写清地点、时间和联系方式。",
  "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
];

const posts = [
  { id: "#4289", title: "南门夜宵摊位营业时间", status: "发布中", variant: "default" },
  { id: "#4288", title: "图书馆闭馆音乐投票", status: "待审核", variant: "destructive" },
  { id: "#4281", title: "校运会失物招领合集", status: "已发布", variant: "secondary" },
] as const;

const services = [
  { title: "修改密码", description: "账号服务", icon: KeyRoundIcon },
  { title: "投稿规则", description: "查看本墙规范", icon: BookOpenIcon },
  { title: "校园服务", description: "推荐入口", icon: SparklesIcon },
];

const adminItems = [
  { title: "审核稿件", description: "18 条待审核", icon: ClipboardListIcon },
  { title: "校园墙设置", description: "品牌、公告、规则", icon: MegaphoneIcon },
  { title: "发布目标", description: "3 个 QQ 墙号", icon: ShieldCheckIcon },
];

const loggedOutStorageKey = "campux:logged-out";

function clearBrowserSession() {
  const cookieNames = new Set(
    document.cookie
      .split(";")
      .map((cookie) => cookie.split("=")[0]?.trim())
      .filter(Boolean),
  );

  ["access-token", "refresh-token", "campux-token", "campux-session"].forEach((name) => cookieNames.add(name));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }

  window.localStorage.clear();
  window.sessionStorage.clear();
}

export function App() {
  const [activeTab, setActiveTab] = useState<MainTab>("post");
  const [loggedIn, setLoggedIn] = useState(() => window.localStorage.getItem(loggedOutStorageKey) !== "1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [postText, setPostText] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const selectedTenant = useMemo(() => {
    return tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0];
  }, [selectedTenantId, tenants]);

  function logout() {
    clearBrowserSession();
    window.localStorage.setItem(loggedOutStorageKey, "1");
    setLoggedIn(false);
    setActiveTab("post");
  }

  function login() {
    window.localStorage.removeItem(loggedOutStorageKey);
    setLoggedIn(true);
  }

  useEffect(() => {
    let ignore = false;

    async function fetchTenants() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/tenants");
        if (!response.ok) {
          throw new Error(`请求失败：${response.status}`);
        }

        const data = (await response.json()) as { tenants: TenantSummary[] };
        if (!ignore) {
          setTenants(data.tenants);
          setSelectedTenantId(data.tenants[0]?.id ?? "");
        }
      } catch (caught) {
        if (!ignore) {
          setError(caught instanceof Error ? caught.message : "无法连接到 Campux API");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void fetchTenants();
    return () => {
      ignore = true;
    };
  }, []);

  if (!loggedIn) {
    return <LoggedOutScreen selectedTenant={selectedTenant} onLogin={login} />;
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MainTab)} className="min-h-dvh">
      <div className="min-h-dvh bg-background md:flex">
        <DesktopSidebar selectedTenant={selectedTenant} activeTab={activeTab} onLogout={logout} />

        <div className="min-h-dvh w-full bg-background pb-24 md:max-w-[760px] md:border-r md:border-slate-100 md:pb-8">
          <Header
            selectedTenant={selectedTenant}
            onLogout={logout}
          />

          <main>
            <TabsContent value="post" className="m-0">
              <PostPage
                error={error}
                postText={postText}
                anonymous={anonymous}
                selectedTenant={selectedTenant}
                onPostTextChange={setPostText}
                onAnonymousChange={setAnonymous}
              />
            </TabsContent>

            <TabsContent value="posts" className="m-0">
              <PostsPage />
            </TabsContent>

            <TabsContent value="services" className="m-0">
              <ServicesPage />
            </TabsContent>

            <TabsContent value="admin" className="m-0">
            <AdminPage selectedTenant={selectedTenant} />
          </TabsContent>
          </main>
        </div>
      </div>

      <TabsList className="fixed inset-x-0 bottom-0 z-40 mx-auto grid h-[64px] max-w-[480px] grid-cols-4 rounded-none border-x-0 border-b-0 bg-white px-2 pb-1 pt-1 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-14 flex-col gap-0.5 rounded-lg text-xs text-slate-500 data-[state=active]:bg-transparent data-[state=active]:text-sky-600 data-[state=active]:shadow-none"
            >
              <Icon data-icon="inline-start" />
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

function LoggedOutScreen({
  selectedTenant,
  onLogin,
}: {
  selectedTenant: TenantSummary | undefined;
  onLogin: () => void;
}) {
  return (
    <main className="flex min-h-dvh bg-white md:items-stretch">
      <aside className="hidden w-[178px] shrink-0 border-r border-slate-100 bg-white md:block">
        <div className="bg-[#42a5f5] py-2 text-center text-2xl font-black text-white">Campux</div>
      </aside>
      <section className="flex min-h-dvh w-full max-w-[520px] flex-col px-4 pt-3 md:justify-center md:px-10 md:pt-0">
        <div>
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant?.name ?? "校园墙"}</span>
        </div>

        <div className="mt-16 rounded-md bg-sky-50 px-4 py-5 md:mt-0">
          <p className="text-xl font-bold text-slate-950">已退出登录</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">你当前没有登录账户。登录后会进入你被授权访问的校园墙。</p>
          <Button className="mt-5 rounded-full bg-[#42a5f5] px-8 font-bold hover:bg-[#42a5f5]" onClick={onLogin}>
            登录
          </Button>
        </div>
      </section>
    </main>
  );
}

function DesktopSidebar({
  selectedTenant,
  activeTab,
  onLogout,
}: {
  selectedTenant: TenantSummary | undefined;
  activeTab: MainTab;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden h-dvh w-[178px] shrink-0 border-r border-slate-100 bg-white md:flex md:flex-col">
      <div className="bg-[#42a5f5] py-2 text-center text-2xl font-black text-white">Campux</div>

      <div className="flex min-h-0 flex-1 flex-col justify-between px-3 py-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent p-0">
          {navItems.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-11 justify-start rounded-md px-3 text-base text-slate-800 shadow-none data-[state=active]:bg-sky-50 data-[state=active]:font-extrabold data-[state=active]:text-slate-950 data-[state=active]:shadow-none"
            >
              <span className="mr-2 text-lg">{item.emoji}</span>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <AccountMenu
          selectedTenant={selectedTenant}
          roleLabel={activeTab === "admin" ? "管理员" : "投稿者"}
          onLogout={onLogout}
          variant="desktop"
        />
      </div>
    </aside>
  );
}

function Header({
  selectedTenant,
  onLogout,
}: {
  selectedTenant: TenantSummary | undefined;
  onLogout: () => void;
}) {
  return (
    <header className="bg-background pb-2">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant?.name ?? "校园墙"}</span>
        </div>
        <AccountMenu selectedTenant={selectedTenant} roleLabel="投稿者" onLogout={onLogout} variant="mobile" />
      </div>
    </header>
  );
}

function AccountMenu({
  selectedTenant,
  roleLabel,
  onLogout,
  variant,
}: {
  selectedTenant: TenantSummary | undefined;
  roleLabel: string;
  onLogout: () => void;
  variant: "mobile" | "desktop";
}) {
  const isDesktop = variant === "desktop";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={
            isDesktop
              ? "flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-slate-50"
              : "flex h-[42px] w-[42px] items-center justify-center rounded-full"
          }
          aria-label="账户菜单"
        >
          <Avatar className={isDesktop ? "h-[50px] w-[50px]" : "h-[38px] w-[38px]"}>
            <AvatarImage src="https://q1.qlogo.cn/g?b=qq&nk=10000&s=100" alt="用户头像" />
            <AvatarFallback>QQ</AvatarFallback>
          </Avatar>
          {isDesktop ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">10000</p>
              <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            </div>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isDesktop ? "start" : "end"} className="w-52">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-slate-900">10000</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{selectedTenant?.name ?? "当前校园墙"} · {roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOutIcon data-icon="inline-start" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PostPage({
  error,
  postText,
  anonymous,
  selectedTenant,
  onPostTextChange,
  onAnonymousChange,
}: {
  error: string;
  postText: string;
  anonymous: boolean;
  selectedTenant: TenantSummary | undefined;
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col">
      {error ? (
        <Alert variant="destructive" className="mx-4 my-2">
          <AlertTitle>连接失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex min-h-10 items-center gap-2 bg-[#f8b94c] px-4 py-2 text-sm text-white">
          <MegaphoneIcon className="size-4 shrink-0" strokeWidth={2.3} />
          <p className="min-w-0 truncate">今晚 22:30 后投稿会顺延到明早审核，请勿重复提交同一内容。</p>
        </div>
      )}

      <section className="px-4 pt-4">
        <div className="flex gap-3">
          <Avatar size="lg" className="h-[50px] w-[50px] shrink-0">
            <AvatarImage src="https://q1.qlogo.cn/g?b=qq&nk=10000&s=100" alt="用户头像" />
            <AvatarFallback>QQ</AvatarFallback>
          </Avatar>
          <Textarea
            value={postText}
            maxLength={1000}
            placeholder="有什么新鲜事？！"
            className="min-h-40 flex-1 resize-none rounded-none border-0 bg-white p-4 text-base leading-7 shadow-none focus-visible:ring-0"
            onChange={(event) => onPostTextChange(event.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <ImageButton label="校运会.jpg" icon={CameraIcon} />
          <ImageButton label="公告截图.png" icon={MegaphoneIcon} />
          <Button
            variant="outline"
            className="h-[70px] w-[70px] rounded-none border-0 bg-white p-0 text-black shadow-none hover:bg-white"
            aria-label="添加图片"
          >
            <ImagePlusIcon className="!size-[70px] stroke-[1.35]" />
          </Button>
        </div>

        <div className="mt-3 w-fit rounded-[5px] bg-[#8bc34a] px-2 py-1 text-lg text-white shadow-sm">
          <div className="flex items-center gap-4">
            <span>匿名投稿</span>
            <Switch checked={anonymous} onCheckedChange={onAnonymousChange} aria-label="匿名投稿" />
          </div>
        </div>

        <Drawer>
          <DrawerTrigger asChild>
            <button className="mt-2 block w-fit rounded-[5px] bg-[#ff8a65] px-2 py-1 text-left text-lg text-white shadow-sm">
              <span>
                请务必遵守 <strong className="inline font-bold">投稿规则</strong>
              </span>
            </button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>投稿规则</DrawerTitle>
              <DrawerDescription>发布前请确认内容符合当前校园墙规范。</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-4">
              {rules.map((rule, index) => (
                <Alert key={rule} className="rounded-2xl">
                  <CheckIcon />
                  <AlertTitle>规则 {index + 1}</AlertTitle>
                  <AlertDescription>{rule}</AlertDescription>
                </Alert>
              ))}
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button>好的</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn">
            <span>
              <SendIcon className="mr-1 inline size-4" />
              投稿
            </span>
          </button>
          <span className="text-xs text-slate-400">{postText.length}/1000</span>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-md bg-sky-50 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">稿件状态</p>
            <p className="mt-1 text-sm text-slate-500">
              审核通过后会同步到 {selectedTenant?.botAccountCount ?? 0} 个墙号。
            </p>
          </div>
          <Badge variant="secondary" className="rounded-md shadow-none">无阻塞</Badge>
        </div>
      </section>
    </div>
  );
}

function ImageButton({ label, icon: Icon }: { label: string; icon: typeof CameraIcon }) {
  return (
    <Button variant="secondary" className="h-[70px] w-[70px] flex-col rounded-[10px] bg-slate-100 p-1 text-slate-800 shadow-none hover:bg-slate-100">
      <Icon data-icon="inline-start" />
      <span className="max-w-[62px] truncate text-[11px]">{label}</span>
    </Button>
  );
}

function PostsPage() {
  return (
    <div className="px-4">
      <SectionHeader title="稿件" subtitle="你的稿件、动态和审核流" action="刷新" icon={RefreshCwIcon} />
      <Tabs defaultValue="mine" className="mt-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="mine">你的稿件</TabsTrigger>
          <TabsTrigger value="feed">动态</TabsTrigger>
          <TabsTrigger value="review">审核</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-3">
          <PostList />
        </TabsContent>
        <TabsContent value="feed" className="mt-3">
          <EmptyCard title="前面的区域，以后再来探索吧" />
        </TabsContent>
        <TabsContent value="review" className="mt-3">
          <PostList review />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServicesPage() {
  return (
    <div className="px-4">
      <SectionHeader title="服务" subtitle="账号服务与推荐网站" />
      <div className="mt-3 flex flex-col gap-2">
        {services.map((service) => (
          <ListButton key={service.title} title={service.title} description={service.description} icon={service.icon} />
        ))}
      </div>
    </div>
  );
}

function AdminPage({ selectedTenant }: { selectedTenant: TenantSummary | undefined }) {
  return (
    <div className="px-4">
      <SectionHeader title="管理" subtitle={`${selectedTenant?.name ?? "校园墙"} 的审核和配置`} />
      <div className="mt-3 flex flex-col gap-2">
        {adminItems.map((item) => (
          <ListButton key={item.title} title={item.title} description={item.description} icon={item.icon} />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  action?: string;
  icon?: typeof RefreshCwIcon;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action && Icon ? (
        <Button variant="outline" size="sm">
          <Icon data-icon="inline-start" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

function PostList({ review = false }: { review?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {posts.map((post) => (
        <Button key={post.id} variant="secondary" className="h-auto justify-between rounded-xl p-3">
          <span className="min-w-0 text-left">
            <span className="block truncate font-medium">{post.title}</span>
            <span className="text-xs text-muted-foreground">
              {post.id}
              {review ? " · 等待审核员处理" : ""}
            </span>
          </span>
          <Badge variant={post.variant}>{post.status}</Badge>
        </Button>
      ))}
    </div>
  );
}

function ListButton({ title, description, icon: Icon }: { title: string; description: string; icon: typeof KeyRoundIcon }) {
  return (
    <Button variant="outline" className="h-auto justify-start gap-3 rounded-xl p-3">
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
  );
}

function EmptyCard({ title }: { title: string }) {
  return (
    <Card className="bg-muted/70">
      <CardContent className="flex min-h-40 items-center justify-center p-6 text-center font-semibold">{title}</CardContent>
    </Card>
  );
}
