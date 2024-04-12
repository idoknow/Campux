package oss

import (
	"context"
	"io"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/spf13/viper"
)

// MinioClient minio client
type MinioClient struct {
	Client *minio.Client
	Bucket string
}

// NewMinioClient new minio client
func NewMinioClient() *MinioClient {

	endpoint := viper.GetString("oss.minio.endpoint")
	accessKeyID := viper.GetString("oss.minio.access_key")
	secretAccessKey := viper.GetString("oss.minio.secret_key")
	useSSL := viper.GetBool("oss.minio.use_ssl")

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		panic(err)
	}
	return &MinioClient{
		Client: client,
		Bucket: viper.GetString("oss.minio.bucket"),
	}
}

func GenerateObjectName() string {
	return uuid.New().String()
}

// 从io.Reader上传文件
func (m *MinioClient) UploadFromIO(ioReader io.Reader, suffix string) (string, error) {

	objectName := GenerateObjectName()

	if suffix != "" {
		objectName += "." + suffix
	}

	_, err := m.Client.PutObject(context.Background(), m.Bucket, objectName, ioReader, -1, minio.PutObjectOptions{})
	return objectName, err
}

// 下载文件到io.Writer
func (m *MinioClient) DownloadToIO(objectName string, ioWriter io.Writer) error {
	obj, err := m.Client.GetObject(context.Background(), m.Bucket, objectName, minio.GetObjectOptions{})

	if err != nil {
		return err
	}

	_, err = io.Copy(ioWriter, obj)

	return err
}
