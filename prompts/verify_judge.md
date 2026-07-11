语音转写的播客笔记里出现了可能转错的专有名词,下面附上网络搜索到的证据。请判断这个词的正确写法。

注意:转写错误通常是「发音相近、写法不同」——比较证据里出现的实体与可疑词的读音和语境契合度(比如 "No Players" 实为播客 "No Priors","面筋" 实为节目 "面基")。若证据里有读音相近且语境吻合的实体,它很可能就是正词。

节目: {{podcast}}
可疑词: {{term}}
上下文: {{context}}

搜索证据:
{{evidence}}

只输出一个 JSON 对象,不要 Markdown 代码块,不要任何前后说明。结构:

{
  "corrected": "修正后的写法;原词本来就对、或证据不足以判断时写 null",
  "confidence": "confirmed 或 speculative:证据明确支持写 confirmed,仅是合理推测写 speculative",
  "evidenceUrl": "最能支撑判断的证据链接;没有写 null",
  "note": "一句话说明判断依据,中文"
}

规则:
- 修正对象仅限专有名词写法(人名/产品/公司/节目/书名),不要改写内容本身
- 证据不支持时宁可 corrected 写 null,严禁编造
- 与原词只有大小写/空格/全半角差异的规范写法也算修正
- 证据为空时 confidence 必须是 speculative
