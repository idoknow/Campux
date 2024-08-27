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
	client *minio.Client
	bucket string
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
		client: client,
		bucket: viper.GetString("oss.minio.bucket"),
	}
}

func generateObjectName() string {
	return uuid.New().String()
}

// 从io.Reader上传文件
func (m *MinioClient) UploadFromIO(ioReader io.Reader, suffix string) (string, error) {

	objectName := generateObjectName()

	if suffix != "" {
		objectName += "." + suffix
	}

	_, err := m.client.PutObject(context.Background(), m.bucket, objectName, ioReader, -1, minio.PutObjectOptions{})
	return objectName, err
}

// 下载文件到io.Writer
func (m *MinioClient) DownloadToIO(objectName string, ioWriter io.Writer) error {
	obj, err := m.client.GetObject(context.Background(), m.bucket, objectName, minio.GetObjectOptions{})

	if err != nil {
		return err
	}

	_, err = io.Copy(ioWriter, obj)

	return err
}

// 检查文件是否存在
func (m *MinioClient) CheckObjectExist(objectName string) (bool, error) {
	_, err := m.client.StatObject(context.Background(), m.bucket, objectName, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
