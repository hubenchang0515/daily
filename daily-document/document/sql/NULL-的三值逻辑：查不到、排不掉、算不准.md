> 原文链接：[NULL 的三值逻辑：查不到、排不掉、算不准 - 码日新 · 每日文章](https://daily.xplanc.org/sql/NULL-的三值逻辑：查不到、排不掉、算不准.md)

---

# NULL 的三值逻辑：查不到、排不掉、算不准

## 1. 空值，不等于「空」

在大多数编程语言里，`null` 或 `nil` 常被当成「无值」来理解。但 SQL 中的 `NULL` 并非一个值，它代表的是 **未知（unknown）**。这个概念上的差异，是之后所有 NULL 陷阱的根源。

要理解它，得先认识 SQL 的 **三值逻辑（Three-Valued Logic）**。SQL 的 `WHERE` 并非只处理 `TRUE` 和 `FALSE`，还多了一个 `UNKNOWN`：

- `TRUE`：条件成立，行会被保留
- `FALSE`：条件不成立，行会被剔除
- `UNKNOWN`：条件的真伪无法判定，行同样会被剔除

也就是说，`WHERE` 过滤的标准永远是「必须为真」，一旦结果是未知，就等同于不满足。

先用一张极简的表来直观感受这个差异：

```sql
CREATE TABLE users (
  id   INT PRIMARY KEY,
  email VARCHAR(100)
);

INSERT INTO users (id, email) VALUES
  (1, 'alice@example.com'),
  (2, NULL),
  (3, 'bob@example.com');
```

如果想找出没有邮箱的用户，下面这条查询的结果会出乎很多人意料：

```sql
SELECT * FROM users WHERE email = NULL;
```

它不会返回 `id = 2` 那一行，结果集往往是空的。原因是 `NULL = NULL` 的求值结果并非 `TRUE`，而是 `UNKNOWN`。

要正确地判断是否为 NULL，必须使用专用的操作符：

```sql
SELECT * FROM users WHERE email IS NULL;     -- 返回 id = 2
SELECT * FROM users WHERE email IS NOT NULL; -- 返回 id = 1, 3
```

记住一条铁律：**`NULL` 只能用 `IS NULL` 和 `IS NOT NULL` 去检验，不能用 `=`、`<>`、`!=`**。

## 2. `IN` 与 `NOT IN` 的隐形地雷

三值逻辑在子查询里一旦遇到 `NULL`，尤其是 `NOT IN`，就会变得极具迷惑性。很多线上报表「莫名少行」都栽在这里。

还是以上表为例，假设我们想找出「邮箱不在某个黑名单列表」中的用户：

```sql
SELECT * FROM users
WHERE email NOT IN ('spam@bad.com');
```

这条语句在黑名单里不含 `NULL` 的前提下是安全的，会返回 `id = 1, 2, 3`（注意 `email` 为 `NULL` 的 `id = 2` 也会被返回）。

现在把黑名单改成下面这种带 `NULL` 的写法：

```sql
SELECT * FROM users
WHERE email NOT IN ('spam@bad.com', NULL);
```

按直觉来说，`'alice@example.com'` 显然不等于这两个值中的任何一个，应该被返回才对。但绝大多数 SQL 引擎（PostgreSQL、MySQL、SQLite 等主流产品）都会让这条查询 **一行也不返回**。

这是为什么？

要理解 `NOT IN (a, b, ..., NULL)` 的等价逻辑。对于某个列 `x`，`x NOT IN (v1, v2, ..., vn)` 可以近似展开为：

`(x <> v1) AND (x <> v2) AND ... AND (x <> vn)`

一旦列表中出现 `NULL`，其中任意一项的 `x <> NULL` 都会得到 `UNKNOWN`。而 `AND` 的性质是：只要有一项为 `UNKNOWN`，且没有 `FALSE` 能直接令整个表达式为假，最终结果就会变成 `UNKNOWN`。

举个例子：对于 `email = 'alice@example.com'`：

`('alice@example.com' <> 'spam@bad.com') AND ('alice@example.com' <> NULL)`  
=> `TRUE AND UNKNOWN` => `UNKNOWN`

由于 `WHERE` 要求结果为 `TRUE` 才会保留行，最终整张表都被过滤掉了。

### 更安全的替代方式

有两种常用且规避此问题的写法：

1. **用 `NOT EXISTS`**  
   `NOT EXISTS` 的语义是「不存在满足关联条件的行」，它并不会因为子查询里出现 `NULL` 而把整组条件变成全未知。

   ```sql
   SELECT u.*
   FROM users u
   WHERE NOT EXISTS (
     SELECT 1
     FROM blacklist b
     WHERE b.email = u.email
   );
   ```

   如果 `blacklist.email` 可以为 `NULL`，上述写法依旧正确。真正的「匹配」只会发生在 `b.email = u.email` 为 `TRUE` 的时候，`NULL` 自然不会产生匹配。

2. **先过滤掉 `NULL`**  
   如果实在想用 `IN`，就要在子查询里显式排除空值。

   ```sql
   SELECT * FROM users
   WHERE email NOT IN (
     SELECT email FROM blacklist WHERE email IS NOT NULL
   );
   ```

个人建议在处理「不在列表中」这类业务时，**优先考虑 `NOT EXISTS`**。它不仅能避开这个 `NULL` 陷阱，在很多场景下也更贴近「关联」的语义，且对空值更不敏感。

## 3. 聚合、分组、去重中的 NULL

`NULL` 在聚合函数里的行为也很容易与直觉相悖。绝大多数聚合函数都会 **忽略 `NULL` 值**，只有极少数例外需要特别留意。

用下面这张订单表来演示：

```sql
CREATE TABLE orders (
  id      INT PRIMARY KEY,
  user_id INT,
  amount  DECIMAL(10,2)
);

INSERT INTO orders (id, user_id, amount) VALUES
  (1, 101, 50.00),
  (2, 101, NULL),
  (3, 102, 30.00),
  (4, NULL, 20.00);
```

来看看常用聚合的结果：

| 函数 | 说明 | 示例 | 结果（大致） |
|---|---|---|---|
| `COUNT(*)` | 统计行数，不关心列值是否为 `NULL` | `COUNT(*) FROM orders` | `4` |
| `COUNT(column)` | 统计该列中 **非 NULL** 的值个数 | `COUNT(amount)` | `3`（忽略了 id=2 的 NULL） |
| `COUNT(DISTINCT column)` | 对非 NULL 值去重后计数 | `COUNT(DISTINCT user_id)` | `2`（101、102，NULL 不会被计入） |
| `SUM(column)` | 对非 NULL 值求和 | `SUM(amount)` | `100.00`（50+30+20） |
| `AVG(column)` | 对非 NULL 值求平均值 | `AVG(amount)` | `33.33...`（100 / 3） |
| `MAX(column)` / `MIN(column)` | 在非 NULL 值之间比较 | `MAX(amount)`、`MIN(amount)` | `50.00`、`20.00` |

这里有两个特别关键的点：

- 想统计「总订单数」要用 `COUNT(*)`，想统计「有金额的订单数」要用 `COUNT(amount)`。
- `AVG` 的分母是「非 NULL 的行数」，而不是表的总行数。如果用它来计算「人均」之类的指标时忘了这一点，数字会悄悄偏高。

### `GROUP BY` 与 `DISTINCT` 对 NULL 的处理

`GROUP BY` 和 `DISTINCT` 都会 **将所有 `NULL` 视作相同的值**，把它们归为同一组。

```sql
SELECT user_id, COUNT(*) AS cnt
FROM orders
GROUP BY user_id;
```

上面的查询会产生三组：`(101, 2)`、`(102, 1)`、`(NULL, 1)`。可以看到，两个 `NULL`（即使来源不同）被放进了同一个分组。

`DISTINCT` 也是同样的逻辑：

```sql
SELECT DISTINCT user_id FROM orders; -- 101, 102, NULL
```

在多数关系型数据库中，这种「把 NULL 合并成一类」的行为是符合 SQL 标准的，但在做业务去重时仍需时刻警惕：有时「未知」和「未知」在业务上并不应该被当成同一个实体。

## 4. 连接、排序与唯一约束

`NULL` 在 `JOIN` 和排序里同样会表现得与普通值不同。

### 连接中的 NULL

在等值连接 `ON a.col = b.col` 时，`NULL = NULL` 结果为 `UNKNOWN`，因此 **`NULL` 永远不会匹配到另一张表中的 `NULL`**。

假设有两张表都存着「渠道信息」：

```sql
CREATE TABLE web_events (event_id INT, channel VARCHAR(50));
CREATE TABLE crm_leads  (lead_id  INT, channel VARCHAR(50));

INSERT INTO web_events VALUES (1, 'google'), (2, NULL);
INSERT INTO crm_leads  VALUES (10, 'google'), (20, NULL);
```

用内连接试图关联它们：

```sql
SELECT w.event_id, l.lead_id
FROM web_events w
INNER JOIN crm_leads l ON w.channel = l.channel;
```

只会返回 `(1, 10)`。`web_events` 中的 `NULL` 和 `crm_leads` 中的 `NULL` 并不会配对成功。

如果业务确实需要把「未知渠道」也关联起来，就只能改用 `IS NOT DISTINCT FROM`（PostgreSQL、SQLite 近期版本等支持）或者手动加上 `OR` 条件：

```sql
-- PostgreSQL / 部分支持 IS NOT DISTINCT FROM 的方言
SELECT w.event_id, l.lead_id
FROM web_events w
INNER JOIN crm_leads l ON w.channel IS NOT DISTINCT FROM l.channel;

-- 更具通用性的写法
SELECT w.event_id, l.lead_id
FROM web_events w
INNER JOIN crm_leads l
  ON w.channel = l.channel
  OR (w.channel IS NULL AND l.channel IS NULL);
```

### 排序中的 NULL

`ORDER BY` 处理 `NULL` 的位置在不同数据库间略有差异：

- **PostgreSQL**：默认 `NULLS LAST`（升序时 NULL 放最后，降序时 NULL 放最前）
- **MySQL**：升序时 `NULL` 通常排在最前，降序时排在最后
- **SQL Server**：升序时 `NULL` 排在最前
- **Oracle**：升序时 `NULL` 排在最后，降序时排在最前

这种不一致在跨库迁移或者统一报表时特别容易导致排序错乱。如果排序对 `NULL` 的位置有业务要求，最稳妥的做法就是 **显式指定**：

```sql
-- 升序时把 NULL 放到最后
SELECT * FROM orders ORDER BY user_id ASC NULLS LAST;

-- 降序时把 NULL 放到最前
SELECT * FROM orders ORDER BY amount DESC NULLS FIRST;
```

并非所有方言都支持 `NULLS FIRST/LAST`，但在支持的数据库里它是最省事也最清晰的方案。

### 唯一约束中的 NULL

还有一个常被忽略的细节：**大多数数据库允许多个 `NULL` 出现在带 `UNIQUE` 约束的列中**。

原因同上：`NULL = NULL` 是 `UNKNOWN`，无法断定是否相等，自然也无法触发唯一性冲突。

```sql
CREATE TABLE contacts (
  id INT PRIMARY KEY,
  email VARCHAR(100) UNIQUE
);

INSERT INTO contacts VALUES (1, NULL);
INSERT INTO contacts VALUES (2, NULL); -- 多数引擎会成功，不会报唯一键冲突
```

只有极少数严格遵循某些历史实现的引擎才会把多个 `NULL` 当成冲突，但这并非 SQL 标准的通用行为。如果业务上要求「最多只能有一条空邮箱」，光靠 `UNIQUE` 是不够的，需要额外用 `PARTIAL UNIQUE INDEX`（PostgreSQL）或者 `UNIQUE KEY ... WHERE email IS NOT NULL` 这类方式来约束。

## 5. 驯服 NULL 的工具箱

与其时刻绞尽脑汁去记住所有三值逻辑细节，不如熟练掌握几个专门用来处理 `NULL` 的函数。它们能让 SQL 的表达更简洁，也更不易踩坑。

| 函数 | 用途 | 示例 |
|---|---|---|
| `COALESCE(expr1, expr2, ..., exprN)` | 返回参数列表中 **第一个非 NULL** 的值。如果全是 NULL，则返回 NULL。最常用也最通用。 | `COALESCE(nickname, username, '匿名用户')` |
| `NULLIF(expr1, expr2)` | 若 `expr1 = expr2` 则返回 `NULL`，否则返回 `expr1`。常用来「制造」NULL，或避免除零。 | `amount / NULLIF(count, 0)`（当 count 为 0 时先转成 NULL，避免除以零错误） |
| `CASE` | 万能兜底。能表达任意 NULL 相关的分支逻辑，且几乎全库通用。 | `CASE WHEN email IS NULL THEN '无' ELSE email END` |

下面给出两个贴近日常的实用示例：

**例 1：报表里用默认值填充空值**

```sql
SELECT
  id,
  COALESCE(email, '未填写') AS contact,
  COALESCE(phone, email, '无联系方式') AS preferred_contact
FROM users;
```

**例 2：用 `NULLIF` 防止除零**

```sql
SELECT
  product_id,
  total_sales / NULLIF(total_orders, 0) AS avg_per_order
FROM sales_summary;
```

若 `total_orders` 为 0，`NULLIF` 会返回 `NULL`，整个除法表达式也会变成 `NULL`。这比直接抛错要体面得多，报表也不会因此整列崩掉。

另外要注意：在 `SELECT` 里用 `COALESCE` 处理显示值是没问题的，但 **不要随意用它去「伪装」NULL 以绕过 `JOIN`、`UNIQUE`、`NOT IN` 这类语义**。那往往只是把问题推迟到下游查询里，等真正排查时会更难定位。

## 6. 一份 NULL 自查清单

每次写涉及空值的 SQL 前，都可以用这张清单快速过一遍：

- [ ] **判空**：是否用 `IS NULL` / `IS NOT NULL` 而不是 `=`？
- [ ] **排除清单**：用 `NOT IN` 时，子查询里是否可能存在 `NULL`？若有可能，改用 `NOT EXISTS` 或先 `WHERE col IS NOT NULL`。
- [ ] **计数**：要统计「行数」用 `COUNT(*)`，要统计「有值的个数」用 `COUNT(col)`，别混淆。
- [ ] **聚合除法**：分母可能为 0 时，用 `NULLIF(分母, 0)` 保护。
- [ ] **关联**：要关联「未知」到「未知」时，是否需要 `IS NOT DISTINCT FROM` 或 `OR (... IS NULL AND ...)`？
- [ ] **排序**：排序对 NULL 顺序有要求时，是否显式加上 `NULLS FIRST/LAST`？
- [ ] **约束预期**：`UNIQUE` 列允许多个 NULL 是否符合业务预期？若不符合，考虑部分唯一索引。
- [ ] **展示**：最终返回给前端/报表的字段，是否该用 `COALESCE` 给出更友好的默认文案？

## 写在最后

SQL 的 `NULL` 并不「坑人」，它只是在严格地遵守「未知无法等于未知」这条逻辑。只要从「**NULL 是未知，不是空字符串，也不是 0**」这个认知出发，再配合 `IS NULL`、`NOT EXISTS`、`COALESCE`、`NULLIF` 这几个工具，大多数 NULL 引发的怪事都能在动手调试前就预判出来。

比起死记每个数据库的细微差异，更重要的是养成一种习惯：**每当看到可能为空的列，都要先问一句「这里要用什么逻辑去处理未知」**。这往往比多写一行测试数据都更能省去后半夜查 bug 的时间。
