package database

type BaseDBManager interface {
	CheckMetadata() error
	AddAccount(acc *AccountPO) error
	GetAccountByUIN(uin int64) (*AccountPO, error)
	UpdatePassword(uin int64, pwd string) error
	GetAccounts(
		uin int64,
		userGroup UserGroup,
		timeOrder int,
		page, pageSize int,
	) ([]AccountExpose, int, error)
	BanAccount(banInfo BanInfo) error
	UnbanAccount(uin int64) error
	GetBanList(
		uin int64,
		onlyValid bool,
		timeOrder int,
		page, pageSize int,
	) ([]BanInfo, int, error)
	UpdateUserGroup(uin int64, userGroup UserGroup) error
	GetCurrentBanInfo(uin int64) (*BanInfo, error)
	CountPost() (int, error)
	GetMaxPostID() (int, error)
	AddPost(post *PostPO) (int, error)
	AddPostLog(log *PostLogPO) error
	GetPostLogs(postID int) ([]PostLogPO, error)
	GetPosts(
		uin int64,
		status PostStatus,
		timeOrder int,
		page, pageSize int,
	) ([]PostPO, int, error)
	GetPost(id int) (*PostPO, error)
	UpdatePostStatus(id int, status PostStatus) error
	SavePostVerbose(pv *PostVerbose) error
	GetMetadata(key string) (string, error)
	SetMetadata(key, value string) error
	AddOAuth2App(app *OAuthAppPO) error
	GetOAuth2App(clientID string) (*OAuthAppPO, error)
	GetOAuth2AppByName(name string) (*OAuthAppPO, error)
	GetOAuth2Apps() ([]OAuthAppPO, error)
	DeleteOAuth2App(clientID string) error
}
