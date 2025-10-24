# frozen_string_literal: true

require 'hibana'

get '/' do |c|
  c.text "Hello from Hibana Ruby! ⚡"
end

get '/hello/:name' do |c|
  name = c.param('name') || 'friend'
  c.text "Hello, #{name}! ⚡"
end

get '/echo' do |c|
  message = c.query('message') || 'Hi from Hibana! ⚡'
  c.json(message: message)
end

module Hibana
  ENTRYPOINT = Hibana.app
end
