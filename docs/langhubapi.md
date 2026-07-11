openapi: 3.1.0
info:
  title: Noumi External API
  version: 1.0.0
  description: API surface for external systems to call Noumi with a single-user API key.
  license:
    name: Proprietary
    url: https://langcore.ai
servers:
  - url: https://www.langhub.cn/api/external/v1
security:
  - BearerAuth: []
tags:
  - name: API Keys
    description: API key lifecycle and metadata.
  - name: Projects
    description: Project, topic, chat-state, and skill APIs.
  - name: Agent
    description: Task execution APIs.
  - name: Workspace
    description: Workspace file APIs.
paths:
  /api-keys:
    get:
      operationId: listApiKeys
      tags: [API Keys]
      security:
        - CookieSession: []
      summary: List API keys for the signed-in user.
      responses:
        "200":
          description: API key list.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiKeyListResponse"
        "401":
          $ref: "#/components/responses/Error"
    post:
      operationId: createApiKey
      tags: [API Keys]
      security:
        - CookieSession: []
      summary: Create an API key bound to the signed-in user.
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateApiKeyRequest"
            example:
              name: CRM integration
              scopes: [projects:manage, agent:execute, workspace:read, workspace:write]
      responses:
        "201":
          description: Created API key. The raw key is returned once.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateApiKeyResponse"
        "400":
          $ref: "#/components/responses/Error"
        "401":
          $ref: "#/components/responses/Error"
  /api-keys/{keyId}:
    parameters:
      - $ref: "#/components/parameters/KeyId"
    get:
      operationId: getApiKey
      tags: [API Keys]
      security:
        - CookieSession: []
      summary: Get API key metadata.
      responses:
        "200":
          description: API key metadata.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiKeyResponse"
        "401":
          $ref: "#/components/responses/Error"
        "404":
          $ref: "#/components/responses/Error"
    patch:
      operationId: updateApiKey
      tags: [API Keys]
      security:
        - CookieSession: []
      summary: Update API key metadata, scopes, expiry, or disabled state.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PatchApiKeyRequest"
      responses:
        "200":
          description: Updated API key metadata.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiKeyResponse"
        "400":
          $ref: "#/components/responses/Error"
        "401":
          $ref: "#/components/responses/Error"
        "404":
          $ref: "#/components/responses/Error"
    delete:
      operationId: revokeApiKey
      tags: [API Keys]
      security:
        - CookieSession: []
      summary: Revoke an API key permanently.
      responses:
        "200":
          $ref: "#/components/responses/Ok"
        "401":
          $ref: "#/components/responses/Error"
        "404":
          $ref: "#/components/responses/Error"
  /projects:
    get:
      operationId: listProjects
      tags: [Projects]
      summary: List projects.
      responses:
        "200":
          description: Project list from the user runtime.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    post:
      operationId: createProject
      tags: [Projects]
      summary: Create a project.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [projectId]
              properties:
                projectId:
                  type: string
                overview:
                  type: string
                initialTopicId:
                  type: string
      responses:
        "201":
          description: Upstream project response.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: listTopics
      tags: [Projects]
      summary: List topics in a project.
      responses:
        "200":
          description: Topic list.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    post:
      operationId: createTopic
      tags: [Projects]
      summary: Create a topic in a project.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [topicId]
              properties:
                topicId:
                  type: string
                description:
                  type: string
      responses:
        "201":
          description: Created topic response.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    delete:
      operationId: deleteTopic
      tags: [Projects]
      summary: Delete a topic.
      responses:
        "200":
          description: Upstream deletion response.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}/chat-state:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    get:
      operationId: getTopicChatState
      tags: [Projects]
      summary: Get topic chat-state.
      responses:
        "200":
          description: Topic chat-state.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    patch:
      operationId: patchTopicChatState
      tags: [Projects]
      summary: Update topic default execution options.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PatchChatStateRequest"
      responses:
        "200":
          description: Updated topic chat-state.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/skills:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: listProjectSkills
      tags: [Projects]
      summary: List skills enabled for a project.
      parameters:
        - name: mode
          in: query
          schema:
            type: string
            enum: [full, stats]
      responses:
        "200":
          description: Skill list or stats.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}/process-files:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    post:
      operationId: attachProcessFiles
      tags: [Agent]
      summary: Attach workspace files or an uploaded file to a topic.
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                paths:
                  type: array
                  items:
                    type: string
                stagingIds:
                  type: array
                  items:
                    type: string
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: Attached process files.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}/messages:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    post:
      operationId: sendTopicMessage
      tags: [Agent]
      summary: Send a prompt to a topic.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SendMessageRequest"
      responses:
        "200":
          description: Queue or dispatch result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}/stream:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    get:
      operationId: streamTopicEvents
      tags: [Agent]
      summary: Stream topic execution events via SSE.
      responses:
        "200":
          description: Server-sent event stream.
          content:
            text/event-stream:
              schema:
                type: string
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/topics/{topicId}/voice-transcriptions:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
      - $ref: "#/components/parameters/TopicId"
    post:
      operationId: transcribeVoice
      tags: [Agent]
      summary: Transcribe an uploaded audio file.
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
                language:
                  type: string
                prompt:
                  type: string
      responses:
        "200":
          description: Transcription result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /tasks/{taskId}:
    parameters:
      - $ref: "#/components/parameters/TaskId"
    get:
      operationId: getTask
      tags: [Agent]
      summary: Get task execution status.
      responses:
        "200":
          description: Task status.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /tasks/{taskId}/cancel:
    parameters:
      - $ref: "#/components/parameters/TaskId"
    post:
      operationId: cancelTask
      tags: [Agent]
      summary: Cancel a task.
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
      responses:
        "200":
          description: Cancel result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /tasks/{taskId}/tool-response:
    parameters:
      - $ref: "#/components/parameters/TaskId"
    post:
      operationId: respondToToolRequest
      tags: [Agent]
      summary: Respond to a pending tool-use confirmation.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [requestId, behavior]
              properties:
                requestId:
                  type: string
                behavior:
                  type: string
                  enum: [allow, deny]
                message:
                  type: string
      responses:
        "200":
          description: Tool response result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/tree:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: getWorkspaceTree
      tags: [Workspace]
      summary: List workspace directory entries.
      parameters:
        - $ref: "#/components/parameters/WorkspacePath"
        - name: withSize
          in: query
          schema:
            type: boolean
        - name: withHasChildren
          in: query
          schema:
            type: boolean
      responses:
        "200":
          description: Workspace tree entries.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/files:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: readWorkspaceFile
      tags: [Workspace]
      summary: Read a workspace file as text or base64.
      parameters:
        - $ref: "#/components/parameters/WorkspacePathRequired"
        - name: format
          in: query
          schema:
            type: string
            enum: [text, binary]
        - name: hash
          in: query
          schema:
            type: string
            enum: [xxh3, blake2b512, sha256]
      responses:
        "200":
          description: File content.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    put:
      operationId: writeWorkspaceFile
      tags: [Workspace]
      summary: Upload or fully overwrite a workspace file.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/WriteFileRequest"
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                path:
                  type: string
                topicId:
                  type: string
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: Write result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    patch:
      operationId: patchWorkspaceFile
      tags: [Workspace]
      summary: Patch a text file by replacement text, line range, or search text.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PatchFileRequest"
      responses:
        "200":
          description: Patch result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    delete:
      operationId: deleteWorkspaceFile
      tags: [Workspace]
      summary: Delete a workspace file or path.
      parameters:
        - $ref: "#/components/parameters/WorkspacePathRequired"
        - name: recursive
          in: query
          schema:
            type: boolean
      responses:
        "200":
          description: Delete result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/directories:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    post:
      operationId: createWorkspaceDirectory
      tags: [Workspace]
      summary: Create a workspace directory recursively.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [path]
              properties:
                path:
                  type: string
      responses:
        "201":
          description: Directory creation result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
    delete:
      operationId: deleteWorkspaceDirectory
      tags: [Workspace]
      summary: Delete a workspace directory recursively by default.
      parameters:
        - $ref: "#/components/parameters/WorkspacePathRequired"
        - name: recursive
          in: query
          schema:
            type: boolean
      responses:
        "200":
          description: Directory delete result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/batch-delete:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    post:
      operationId: batchDeleteWorkspacePaths
      tags: [Workspace]
      summary: Delete multiple workspace files or directories.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [paths]
              properties:
                paths:
                  type: array
                  items:
                    type: string
                recursive:
                  type: boolean
      responses:
        "200":
          description: Batch delete result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/batch-move:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    post:
      operationId: batchMoveWorkspacePaths
      tags: [Workspace]
      summary: Move or rename multiple workspace paths.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [operations]
              properties:
                operations:
                  type: array
                  items:
                    type: object
                    required: [fromPath, toPath]
                    properties:
                      fromPath:
                        type: string
                      toPath:
                        type: string
      responses:
        "200":
          description: Batch move result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/copy:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    post:
      operationId: copyWorkspacePath
      tags: [Workspace]
      summary: Copy a workspace file or directory.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [fromPath, toPath]
              properties:
                fromPath:
                  type: string
                toPath:
                  type: string
                overwrite:
                  type: boolean
                onConflict:
                  type: string
                  enum: [error, suffix]
      responses:
        "200":
          description: Copy result.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/download:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: downloadWorkspacePath
      tags: [Workspace]
      summary: Download one workspace file, or one directory as a zip archive.
      parameters:
        - $ref: "#/components/parameters/WorkspacePathRequired"
        - name: disposition
          in: query
          schema:
            type: string
            enum: [attachment, inline]
      responses:
        "200":
          description: File or zip bytes.
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
            application/zip:
              schema:
                type: string
                format: binary
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
  /projects/{projectId}/workspace/search:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    get:
      operationId: searchWorkspaceByName
      tags: [Workspace]
      summary: Search workspace files or directories by name/path.
      parameters:
        - name: q
          in: query
          schema:
            type: string
        - name: kind
          in: query
          schema:
            type: string
            enum: [file, directory]
        - name: mode
          in: query
          schema:
            type: string
            enum: [name, path]
        - name: basePath
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        "200":
          description: Search results.
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Error"
        "403":
          $ref: "#/components/responses/Error"
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: API key
    CookieSession:
      type: apiKey
      in: cookie
      name: better-auth.session_token
  parameters:
    KeyId:
      name: keyId
      in: path
      required: true
      schema:
        type: string
    ProjectId:
      name: projectId
      in: path
      required: true
      schema:
        type: string
    TopicId:
      name: topicId
      in: path
      required: true
      schema:
        type: string
    TaskId:
      name: taskId
      in: path
      required: true
      schema:
        type: string
    WorkspacePath:
      name: path
      in: query
      required: false
      schema:
        type: string
    WorkspacePathRequired:
      name: path
      in: query
      required: true
      schema:
        type: string
  responses:
    Ok:
      description: Successful operation.
      content:
        application/json:
          schema:
            type: object
            properties:
              ok:
                type: boolean
    Error:
      description: Error response.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
  schemas:
    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
    ApiKeyScope:
      type: string
      enum: [projects:manage, agent:execute, workspace:read, workspace:write]
    ApiKey:
      type: object
      properties:
        id:
          type: string
        userId:
          type: string
        name:
          type: [string, "null"]
        description:
          type: [string, "null"]
        keyPrefix:
          type: string
        scopes:
          type: array
          items:
            $ref: "#/components/schemas/ApiKeyScope"
        status:
          type: string
          enum: [active, disabled, expired, revoked]
        expiresAt:
          type: [string, "null"]
          format: date-time
        disabledAt:
          type: [string, "null"]
          format: date-time
        lastUsedAt:
          type: [string, "null"]
          format: date-time
        revokedAt:
          type: [string, "null"]
          format: date-time
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    CreateApiKeyRequest:
      type: object
      properties:
        name:
          type: [string, "null"]
        description:
          type: [string, "null"]
        scopes:
          type: array
          items:
            $ref: "#/components/schemas/ApiKeyScope"
        expiresAt:
          type: [string, "null"]
          format: date-time
        disabled:
          type: boolean
    PatchApiKeyRequest:
      $ref: "#/components/schemas/CreateApiKeyRequest"
    ApiKeyResponse:
      type: object
      properties:
        credential:
          $ref: "#/components/schemas/ApiKey"
    ApiKeyListResponse:
      type: object
      properties:
        credentials:
          type: array
          items:
            $ref: "#/components/schemas/ApiKey"
    CreateApiKeyResponse:
      type: object
      properties:
        credential:
          $ref: "#/components/schemas/ApiKey"
        rawKey:
          type: string
    PatchChatStateRequest:
      type: object
      properties:
        modelTier:
          type: string
          enum: [pro, promax]
        cognitiveMode:
          type: object
        automationMode:
          type: string
          enum: [ask, auto]
        planMode:
          type: boolean
    SendMessageRequest:
      type: object
      properties:
        prompt:
          type: string
        displayPrompt:
          type: string
        clientMessageId:
          type: string
        modelTier:
          type: string
        automationMode:
          type: string
        cognitiveMode:
          type: object
        attachedProcessFileIds:
          type: array
          items:
            type: string
    WriteFileRequest:
      type: object
      required: [path, content]
      properties:
        path:
          type: string
        content:
          type: string
        encoding:
          type: string
          enum: [text, base64]
        topicId:
          type: string
    PatchFileRequest:
      type: object
      required: [path, content]
      properties:
        path:
          type: string
        content:
          type: string
        startLine:
          type: integer
        endLine:
          type: integer
        search:
          type: string
        replace:
          type: string