require "json"
require "minitest/autorun"

module HostBridge
  class << self
    def reset!
      @queries = []
      @responses = []
    end

    def queries
      @queries ||= []
    end

    def enqueue_response(payload = nil, &block)
      responses << (block || payload)
    end

    private

    def responses
      @responses ||= []
    end
  end

  def self.run_d1_query(binding_name, sql, bindings, action)
    entry = {
      binding: binding_name,
      sql: sql,
      bindings: bindings,
      action: action,
    }
    queries << entry
    responder = responses.shift
    case responder
    when Proc
      responder.call(entry)
    when String
      responder
    when nil
      JSON.generate([])
    else
      responder.to_s
    end
  end
end

require_relative "../src/ruby/app/hibana/orm"

class User < Hibana::Record
  table_name "users"
  primary_key :id

  attribute :name, :string

  has_many :posts
end

class Post < Hibana::Record
  table_name "posts"
  primary_key :id
  timestamps true

  attribute :title, :string
  attribute :views, :integer, default: 0
  attribute :status, :string, default: "draft"

  belongs_to :user

  scope :published, -> { where(status: "published") }
end

class OrmSpec < Minitest::Test
  def setup
    HostBridge.reset!
  end

  def test_select_with_where_and_limit
    HostBridge.enqueue_response(JSON.generate([{ "id" => 1, "title" => "Hello", "views" => 1500 }]))

    records = Post
      .select(:id, :title)
      .where(status: "published")
      .where("views >= ?", 1000)
      .order(views: :desc)
      .limit(5)
      .to_a

    assert_equal 1, records.length
    assert_equal "Hello", records.first.title

    query = HostBridge.queries.last
    assert_equal "DB", query[:binding]
    assert_equal ["published", 1000], query[:bindings]
    assert_equal "all", query[:action]
    assert_includes query[:sql], "SELECT id, title FROM posts"
    assert_includes query[:sql], "views >= ?"
    assert_includes query[:sql], "ORDER BY views DESC"
    assert_includes query[:sql], "LIMIT 5"
  end

  def test_find_raises_when_missing
    HostBridge.enqueue_response(JSON.generate([]))

    assert_raises(Hibana::ORM::RecordNotFound) do
      Post.find(99)
    end
  end

  def test_create_assigns_primary_key_and_timestamps
    HostBridge.enqueue_response(JSON.generate({ "success" => true, "meta" => { "last_row_id" => 42 } }))

    post = Post.create(title: "Draft")

    assert_equal 42, post.primary_key_value
    assert post.persisted?

    query = HostBridge.queries.last
    assert_equal "run", query[:action]
    assert_match(/INSERT INTO posts/i, query[:sql])
    assert_includes query[:bindings], "Draft"
    assert_includes query[:bindings], 0
    assert_includes query[:bindings], "draft"
    assert_equal 5, query[:bindings].length
  end

  def test_update_persists_changes
    post = Post.instantiate_from_row("id" => 7, "title" => "Old", "views" => 1)
    HostBridge.enqueue_response(JSON.generate({ "success" => true }))

    post.update(title: "New Title", views: 2)

    query = HostBridge.queries.last
    assert_equal "run", query[:action]
    assert_includes query[:sql], "UPDATE posts SET"
    assignments = query[:bindings][0...-1]
    assert_includes assignments, "New Title"
    assert_includes assignments, 2
    assert_equal 7, query[:bindings].last
    assert_equal 4, query[:bindings].length
  end

  def test_belongs_to_and_has_many_helpers
    post = Post.instantiate_from_row("id" => 1, "user_id" => 5)
    HostBridge.enqueue_response(JSON.generate([{ "id" => 5, "name" => "Alice" }]))

    user = post.user
    assert_equal "Alice", user.name

    HostBridge.enqueue_response(JSON.generate([{ "id" => 10, "title" => "Hello", "views" => 1, "user_id" => 5 }]))
    posts = user.posts.to_a
    assert_equal 1, posts.length
    assert_equal "Hello", posts.first.title
  end

  def test_count_and_exists_helpers
    HostBridge.enqueue_response(JSON.generate({ "count" => 2 }))
    HostBridge.enqueue_response(JSON.generate([{ "id" => 9 }]))

    relation = Post.published
    assert_equal 2, relation.count
    assert relation.exists?
  end

  def test_delete_all_uses_where_clause
    HostBridge.enqueue_response(JSON.generate({ "success" => true }))
    Post.where(status: "draft").delete_all

    query = HostBridge.queries.last
    assert_equal "run", query[:action]
    assert_includes query[:sql], "DELETE FROM posts"
    assert_includes query[:sql], "status = ?"
    assert_equal ["draft"], query[:bindings]
  end

  def test_assign_attributes_rejects_unknown_keys
    assert_raises(Hibana::ORM::InvalidQuery) do
      Post.create(unknown_column: "oops")
    end
  end

  def test_assign_attributes_allows_values_from_existing_columns
    post = Post.instantiate_from_row("id" => 8, "legacy_flag" => "Y")
    HostBridge.enqueue_response(JSON.generate({ "success" => true }))

    post.update(legacy_flag: "N")

    query = HostBridge.queries.last
    assert_includes query[:sql], "legacy_flag = ?"
    assert_equal ["N", 8], query[:bindings].values_at(0, -1)
  end
end
