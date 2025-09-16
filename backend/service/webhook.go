package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/RockChinQ/Campux/backend/database"
)

type WebhookService struct {
	CommonService
}

type WebhookEvent struct {
	Event     string      `json:"event"`
	Timestamp int64       `json:"timestamp"`
	Data      interface{} `json:"data"`
}

type PostCreatedData struct {
	PostID    int      `json:"post_id"`
	UUID      string   `json:"uuid"`
	Uin       int64    `json:"uin"`
	Text      string   `json:"text"`
	Images    []string `json:"images"`
	Anon      bool     `json:"anon"`
	CreatedAt int64    `json:"created_at"`
}

func NewWebhookService(db database.BaseDBManager) *WebhookService {
	return &WebhookService{
		CommonService: CommonService{
			DB: db,
		},
	}
}

func (ws *WebhookService) GetWebhookURLs() ([]string, error) {
	urlsStr, err := ws.DB.GetMetadata("webhook_urls")
	if err != nil {
		return nil, err
	}

	var urls []string
	if urlsStr == "" || urlsStr == "[]" {
		return urls, nil
	}

	err = json.Unmarshal([]byte(urlsStr), &urls)
	if err != nil {
		return nil, err
	}

	return urls, nil
}

func (ws *WebhookService) SetWebhookURLs(urls []string) error {
	urlsBytes, err := json.Marshal(urls)
	if err != nil {
		return err
	}

	return ws.DB.SetMetadata("webhook_urls", string(urlsBytes))
}

func (ws *WebhookService) AddWebhookURL(url string) error {
	urls, err := ws.GetWebhookURLs()
	if err != nil {
		return err
	}

	for _, existingURL := range urls {
		if existingURL == url {
			return fmt.Errorf("webhook URL already exists")
		}
	}

	urls = append(urls, url)
	return ws.SetWebhookURLs(urls)
}

func (ws *WebhookService) RemoveWebhookURL(url string) error {
	urls, err := ws.GetWebhookURLs()
	if err != nil {
		return err
	}

	var newURLs []string
	for _, existingURL := range urls {
		if existingURL != url {
			newURLs = append(newURLs, existingURL)
		}
	}

	return ws.SetWebhookURLs(newURLs)
}

func (ws *WebhookService) TriggerPostCreated(post *database.PostPO) error {
	webhookURLs, err := ws.GetWebhookURLs()
	if err != nil || len(webhookURLs) == 0 {
		return nil
	}

	event := WebhookEvent{
		Event:     "post.created",
		Timestamp: time.Now().Unix(),
		Data: PostCreatedData{
			PostID:    post.ID,
			UUID:      post.UUID,
			Uin:       post.Uin,
			Text:      post.Text,
			Images:    post.Images,
			Anon:      post.Anon,
			CreatedAt: post.CreatedAt.Unix(),
		},
	}

	for _, webhookURL := range webhookURLs {
		go func(url string) {
			ws.sendWebhook(url, event)
		}(webhookURL)
	}

	return nil
}

func (ws *WebhookService) sendWebhook(url string, event WebhookEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}
