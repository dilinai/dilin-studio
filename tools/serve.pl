#!/usr/bin/env perl
# 本机小服务（Perl 版·Mac／Linux 上没有 Node 也没有 Python 时用；Mac 都自带 Perl）：把 app/ 放在 http://localhost:41730/ 上、自动打开浏览器。只听本机。
#   埠固定 41730：工程存在浏览器里时记在这个网址底下。已经开着一份 ⇒ 直接打开浏览器就结束。
use strict;
use warnings;
use IO::Socket::INET;
use File::Basename qw(dirname);
use File::Spec;
use Cwd qw(abs_path);

my $port = $ENV{PORT} || 41730;
my $app = abs_path(File::Spec->catdir(dirname(abs_path($0)), '..', 'app'));
my $url = "http://localhost:$port/";
my $no_open = grep { $_ eq '--no-open' } @ARGV;
my %types = (
  html => 'text/html; charset=utf-8', js => 'text/javascript; charset=utf-8', mjs => 'text/javascript; charset=utf-8', css => 'text/css; charset=utf-8',
  json => 'application/json; charset=utf-8', txt => 'text/plain; charset=utf-8', svg => 'image/svg+xml', png => 'image/png', jpg => 'image/jpeg',
  jpeg => 'image/jpeg', gif => 'image/gif', webp => 'image/webp', ico => 'image/x-icon', woff => 'font/woff', woff2 => 'font/woff2', ttf => 'font/ttf',
  wasm => 'application/wasm', mp3 => 'audio/mpeg', mp4 => 'video/mp4', webm => 'video/webm',
);

sub open_browser {
  return if $no_open;
  if ($^O eq 'darwin') { system('open', $url) } else { system("xdg-open '$url' >/dev/null 2>&1 &") }
}

sub already_ours {
  my $s = IO::Socket::INET->new(PeerAddr => '127.0.0.1', PeerPort => $port, Proto => 'tcp', Timeout => 2) or return 0;
  print $s "GET /version.json HTTP/1.0\r\nHost: localhost\r\n\r\n";
  local $/; my $body = <$s> // ''; close $s;
  return $body =~ /"name"\s*:\s*"dilin-studio"/ ? 1 : 0;
}

my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp', Listen => 32, ReuseAddr => 1);
if (!$server) {
  if (already_ours()) { print "Dilin Studio 已經開著：$url\n"; open_browser(); exit 0 }
  print "埠 $port 被別的程式佔了。請關掉它，或用 PORT=別的數字 再開（換埠看不到之前存在瀏覽器裡的工程）。\n";
  exit 1;
}
print "Dilin Studio 開在 $url（關掉這個視窗或按 Ctrl+C 就停）\n";
open_browser();

$SIG{PIPE} = 'IGNORE';
while (my $c = $server->accept) {
  my $line = <$c> // '';
  while (my $h = <$c>) { last if $h =~ /^\r?\n$/ }
  my ($method, $target) = $line =~ /^(GET|HEAD) (\S+)/;
  my $status = '200 OK'; my $type = 'text/plain; charset=utf-8'; my $body = '';
  if (!$method) { $status = '400 Bad Request' }
  else {
    my $path = (split /\?/, $target)[0];
    $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
    $path .= 'index.html' if $path =~ m{/$};
    if ($path =~ m{(^|/)\.\.(/|$)}) { $status = '403 Forbidden' }
    else {
      my $file = $app . $path;
      if (-f $file && open(my $fh, '<:raw', $file)) {
        local $/; $body = <$fh>; close $fh;
        my ($ext) = $file =~ /\.([A-Za-z0-9]+)$/;
        $type = $types{lc($ext // '')} // 'application/octet-stream';
      } else { $status = '404 Not Found'; $body = 'not found' }
    }
  }
  print $c "HTTP/1.0 $status\r\nContent-Type: $type\r\nContent-Length: " . length($body) . "\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
  print $c $body if $method && $method ne 'HEAD';
  close $c;
}
