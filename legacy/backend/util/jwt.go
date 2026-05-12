package util

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

// 生成jwt token
func GenerateUserJWTToken(uin int64) (string, error) {

	// 生成token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uin": uin,
		"exp": time.Now().Add(time.Second * time.Duration(viper.GetInt("auth.jwt.expire"))).Unix(),
	})

	// 签名
	tokenString, err := token.SignedString([]byte(viper.GetString("auth.jwt.secret")))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

// 解析jwt token
func ParseUserJWTToken(tokenString string) (int64, error) {

	// 解析token
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(viper.GetString("auth.jwt.secret")), nil
	})
	if err != nil {
		return 0, err
	}

	// 获取uin
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, err
	}

	uin, ok := claims["uin"].(float64)
	if !ok {
		return 0, err
	}

	return int64(uin), nil
}

func GenerateOAuth2CodeJWTToken(codeUUID, clientID string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"codeuuid": codeUUID,
		"exp":      time.Now().Add(time.Second * 60 * 10).Unix(),
	})

	tokenString, err := token.SignedString([]byte(viper.GetString("oauth2.server.code_secret") + clientID))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func ParseOAuth2CodeJWTToken(tokenString, clientID string) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(viper.GetString("oauth2.server.code_secret") + clientID), nil
	})

	if err != nil {
		return "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", err
	}

	codeUUID, ok := claims["codeuuid"].(string)
	if !ok {
		return "", err
	}

	return codeUUID, nil
}

func GenerateOAuth2AccessTokenJWTToken(uin int64, clientID string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uin": uin,
		"cid": clientID,
		"exp": time.Now().Add(time.Second * time.Duration(viper.GetInt("oauth2.server.ak_expire"))).Unix(),
	})

	tokenString, err := token.SignedString([]byte(viper.GetString("oauth2.server.access_secret")))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func ParseOAuth2AccessTokenJWTToken(tokenString string) (int64, string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(viper.GetString("oauth2.server.access_secret")), nil
	})
	if err != nil {
		return 0, "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, "", err
	}

	uin, ok := claims["uin"].(float64)
	if !ok {
		return 0, "", err
	}

	cid, ok := claims["cid"].(string)
	if !ok {
		return 0, "", err
	}

	return int64(uin), cid, nil
}
